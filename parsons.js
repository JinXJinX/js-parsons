'use strict';
(function($, _) { // wrap in anonymous function to not show some helper variables

   // regexp used for trimming
   var trimRegexp = /^\s*(.*?)\s*$/;
   var translations = {
     en: {
       trash_label: 'Drag from here',
       solution_label: 'Construct your solution here',
       order: function() {
         return "Code fragments in your program are wrong, or in wrong order. This can be fixed by moving, removing, or replacing highlighted fragments.";},
       lines_missing: function() {
         return "Your program has too few code fragments.";},
       lines_too_many: function() {
         return "Your program has too many code fragments.";},
       no_matching: function(lineNro) {
         return "Based on language syntax, the highlighted fragment (" + lineNro + ") is not correctly indented."; },
       no_matching_open: function(lineNro, block) {
         return "The " + block + " ended on line " + lineNro + " never started."; },
       no_matching_close: function(lineNro, block) {
         return "Block " + block + " defined on line " + lineNro + " not ended properly";
       },
       block_close_mismatch: function(closeLine, closeBlock, openLine, inBlock) {
         return "Cannot end block " + closeBlock + " on line " + closeLine + " when still inside block " + inBlock + " started on line " + openLine;
       },
       block_structure: function(lineNro) { return "The highlighted fragment " + lineNro + " belongs to a wrong block (i.e. indentation)."; },
       unittest_error: function(errormsg) {
         return "<span class='msg'>Error in parsing/executing your program</span><br/> <span class='errormsg'>" + errormsg + "</span>";
       },
       unittest_output_assertion: function(expected, actual) {
        return "Expected output: <span class='expected output'>" + expected + "</span>" +
              "Output of your program: <span class='actual output'>" + actual + "</span>";
       },
       unittest_assertion: function(expected, actual) {
        return "Expected value: <span class='expected'>" + expected + "</span><br>" +
              "Actual value: <span class='actual'>" + actual + "</span>";
       },
       variabletest_assertion: function(varname, expected, actual) {
        return "Expected value of variable " + varname + ": <span class='expected'>" + expected + "</span><br>" +
              "Actual value: <span class='actual'>" + actual + "</span>";
       }
     }
   };

  // Graders
  var graders = {};
  // Grader that will execute the code and check variable values after that
  // Expected and supported options:
  //  - vartests (required): array of variable test objects
  // Each variable test object can/must have the following properties:
  //  - initcode: code that will be prepended before the learner solution code
  //  - code: code that will be appended after the learner solution code
  //  - message (required): a textual description of the test, shown to learner
  // Properties specifying what is tested:
  //  - variables: an object with properties for each variable name to
  //                          be tested; the value of the property is the expected
  //                          value
  // or
  //  - variable: a variable name to be tested
  //  - expected: expected value of the variable after code execution
  var VariableCheckGrader = function(parson) {
    this.parson = parson;
  };
  graders.VariableCheckGrader = VariableCheckGrader;
  // Executes the given Python code and returns an object with two properties:
  //  mainmod: the result of Skulpt importMainWithBody call with the given code
  //  output: the output of the program
  // Note, that the Skulpt execution can throw an exception, which will not be handled
  // by this function, so the caller should take care of that.
  VariableCheckGrader.prototype._python_exec = function(code) {
      var output = "";
      // function for reading python imports with skulpt
      function builtinRead(x) {
        if (Sk.builtinFiles === undefined || Sk.builtinFiles["files"][x] === undefined)
          throw "File not found: '" + x + "'";
        return Sk.builtinFiles["files"][x];
      }
      // configure Skulpt
      Sk.execLimit = this.parson.options.exec_limit || 2500; // time limit for the code to run
      Sk.configure({
          output: function(str) { output += str; },
          python3: this.parson.options.python3 || false,
          read: builtinRead
      });
      return {mainmod: Sk.importMainWithBody("<stdin>", false, code), output: output};
  };

  // Executes the given code using Skulpt and returns an object with variable
  // values of the variables given in the variables array.
  // Possible errors will be in the _error property of the returned object.
  // Output of the code will be in _output property of the result.
  // Example: this._variablesAfterExecution("x=0\ny=2\nprint x", ["x", "y"])
  //    will return object {"x": 0, "y": 2, "_output": "0"}
  VariableCheckGrader.prototype._variablesAfterExecution = function(code, variables) {
    var output = "",
      execResult, mainmod,
      result = {'variables': {}},
      varname;
    try {
      execResult = this._python_exec(code);
    } catch (e) {
      return {"_output": output, "_error": "" + e};
    }
    mainmod = execResult.mainmod;
    for (var i = 0; i < variables.length; i++) {
      varname = variables[i];
      result.variables[varname] = mainmod.tp$getattr(varname);
    }
    result._output = execResult.output;
    return result;
  };

  // Formats a JavaScript variable to the corresponding Python value *and*
  // formats a Skulpt variable to the corresponding Python value
  VariableCheckGrader.prototype.formatVariableValue = function(varValue) {
    var varType = typeof varValue;
    if (varType === "undefined" || varValue === null) {
      return "None";
    } else if (varType === "string") { // show strings in quotes
      return '"' + varValue + '"';
    } else if (varType === "boolean") { // Python booleans with capital first letter
      return varValue?"True":"False";
    } else if ($.isArray(varValue)) { // JavaScript arrays
      return '[' + varValue.join(', ') + ']';
    } else if (varType === "object" && varValue.tp$name === "number") { // Python numbers
      return varValue.v;
    } else if (varType === "object" && varValue.tp$name === "NoneType") { // None
      return "None";
    } else if (varType === "object" && varValue.tp$name === "bool") { // Python strings
      return varValue.v?"True":"False";
    } else if (varType === "object" && varValue.tp$name === "str") { // Python strings
      return '"' + varValue.v + '"';
    } else if (varType === "object" && varValue.tp$name === "list") { // Python lists
      return '[' + varValue.v.join(', ') + ']';
    } else {
      return varValue;
    }
  };

  // Fix or strip line numbers in the (error) message
  // Basically removes the number of lines in prependCode from the line number shown.
  VariableCheckGrader.prototype.stripLinenumberIfNeeded = function(msg, prependCode, studentCode) {
    var lineNbrRegexp = /.*on line ([0-9]+).*/;
    // function that fixes the line numbers in student feedback
    var match = msg.match(lineNbrRegexp);
    if (match) {
      var lineNo = parseInt(match[1], 10),
          lowerLimit = prependCode? prependCode.split('\n').length :0,
          upperLimit = lowerLimit + studentCode.split('\n').length - 1;
      // if error in prepended code or tests, remove the line number
      if (lineNo <= lowerLimit || lineNo > upperLimit) {
        return msg.replace(' on line ' + lineNo, '');
      } else if (lowerLimit > 0) {
        // if error in student code, make sure the line number matches student lines
        return msg.replace(' on line ' + lineNo, ' on line ' + (lineNo - lowerLimit));
      }
    }
    return msg;
  };

  //Return executable code in one string
  VariableCheckGrader.prototype._codelinesAsString = function(codeLines) {
    var executableCode = "";
    $.each(codeLines, function(index, codeLine) {
      // split codeblocks on br elements
      var lines = codeLine.getCode().split(/<br\s*\/?>/);

      // go through all the lines
      for (var i = 0; i < lines.length; i++) {
        // add indents and get the text for the line (to remove the syntax highlight html elements)
        executableCode += python_indents[codeLine.indent] + $("<span>" + lines[i] + "</span>").text() + "\n";
      }
    });
    return executableCode;
  };
  VariableCheckGrader.prototype.grade = function(codeLines) {
    var parson = this.parson,
        that = this,
        feedback = "",
        log_errors = [],
        all_passed = true;
    $.each(parson.options.vartests, function(index, testdata) {
      var student_code = that._codelinesAsString(codeLines);
      var executableCode = (testdata.initcode || "") + "\n" + student_code + "\n" + (testdata.code || "");
      var variables, expectedVals;

      if ('variables' in testdata) {
        variables = _.keys(testdata.variables);
        expectedVals = testdata.variables;
      } else {
        variables = [testdata.variable];
        expectedVals = {};
        expectedVals[testdata.variable] = testdata.expected;
      }
      var res = that._variablesAfterExecution(executableCode, variables);
      var testcaseFeedback = "",
          success = true,
          log_entry = {'code': testdata.code, 'msg': testdata.message},
          expected_value,
          actual_value;
      if ("_error" in res) {
        testcaseFeedback += parson.translations.unittest_error(that.stripLinenumberIfNeeded(res._error,
                                                                                      testdata.initcode,
                                                                                      student_code));
        success = false;
        log_entry.type = "error";
        log_entry.errormsg = res._error;
      } else {
        log_entry.type = "assertion";
        log_entry.variables = {};
        for (var j = 0; j < variables.length; j++) {
          var variable = variables[j],
              variableSuccess;
          if (variable === "__output") { // checking output of the program
            expected_value = expectedVals[variable];
            actual_value = res._output;
            variableSuccess = (actual_value == expected_value); // should we do a strict test??
            testcaseFeedback += "<div class='" + (variableSuccess?"pass":"fail") + "'>";
            testcaseFeedback += parson.translations.unittest_output_assertion(expected_value, actual_value) +
                                "</div>";
          } else {
            expected_value = that.formatVariableValue(expectedVals[variable]);
            actual_value = that.formatVariableValue(res.variables[variable]);
            variableSuccess = (actual_value == expected_value);  // should we do a strict test??
            testcaseFeedback += "<div class='" + (variableSuccess?"pass":"fail") + "'>";
            testcaseFeedback += parson.translations.variabletest_assertion(variable, expected_value, actual_value) +
                                "</div>";
          }
          log_entry.variables[variable] = {expected: expected_value, actual: actual_value};
          if (!variableSuccess) {
            success = false;
          }
        }
      }
      all_passed = all_passed && success;
      log_entry.success = success;
      log_errors.push(log_entry);
      feedback += "<div class='testcase " + (success?"pass":"fail") +
                  "'><span class='msg'>" + testdata.message + "</span><br>" +
                  testcaseFeedback + "</div>";
    });
    return { html: feedback, tests: log_errors, success: all_passed };
  };

  // A grader to be used for exercises which draw turtle graphics.
  // Required options:
  //  - turtleModelCode: The code constructing the model drawing. The turtle is initialized
  //                    to modelTurtle variable, so your code should use that variable.
  //
  // Options that can be specified (that is, optional):
  //  - turtlePenDown: a boolean specifying whether or not the pen should be put down
  //                   initially for the student constructed code
  //  - turtleModelCanvas: ID of the canvas DOM element where the model solution will be drawn.
  //                  Defaults to modelCanvas.
  //  - turtleStudentCanvas: ID of the canvas DOM element where student turtle will draw.
  //                  Defaults to studentCanvas.
  //
  // Grading is based on comparing the commands executed by the model and student turtle.
  // If the executable_code option is also specified, the code on each line of that option will
  // be executed instead of the code in the student constructed lines. Note, that the student
  // code should use the variable myTurtle for commands to control the turtle in order for the
  // grading to work.
  var TurtleGrader = function(p) {
    this.parson = p;
    // execute the model solution turtlet path to have the target "picture" visible in the
    // beginning
    var modelCommands = this._executeTurtleModel();

    // specify variable tests for the commands executed by the student turtlet and the model
    var penDown = typeof p.options.turtlePenDown === "boolean"?p.options.turtlePenDown:true;
    var vartests = [
      {initcode: "import parsonturtle\nmyTurtle = parsonturtle.ParsonTurtle()\n" +
        "myTurtle.speed(0.3)\nmyTurtle.pensize(3, False)\n" +
        (penDown ? "" : "myTurtle.up()\n"), // set the state of the pen
        code: (p.options.turtleTestCode?p.options.turtleTestCode:"") + "\ncommands = myTurtle.commands()\npass",
        message: "", variables: {commands: modelCommands}}
    ];
    // set the vartests in the parson options
    p.options.vartests = vartests;
  };
  // expose the grader to ParsonsWidget._graders
  graders.TurtleGrader = TurtleGrader;
  // copy the python execution functions from VariableCheckGrader
  TurtleGrader.prototype._python_exec = VariableCheckGrader.prototype._python_exec;
  TurtleGrader.prototype._variablesAfterExecution = VariableCheckGrader.prototype._variablesAfterExecution;
  // Execute the model turtlet code
  TurtleGrader.prototype._executeTurtleModel = function() {
    let code = "import parsonturtle\nmodelTurtle = parsonturtle.ParsonTurtle()\n" +
               "modelTurtle.color(160, 160, 160, False)\n" +
                this.parson.options.turtleModelCode +
               "\ncommands = modelTurtle.commands()\n";
    Sk.canvas = this.parson.options.turtleModelCanvas || "modelCanvas";
    var result = this._variablesAfterExecution(code, ["commands"]);
    if (!result.variables || !result.variables.commands || !result.variables.commands.v) {
      return "None";
    }
    return result.variables.commands.v;
  };
  // grade the student solution
  TurtleGrader.prototype.grade = function(codeLines) {
    // set the correct canvas where the turtle should draw
    Sk.canvas = this.parson.options.turtleStudentCanvas || "studentCanvas";
    // Pass the grading on to either the LangTranslationGrader or VariableChecker
    if (this.parson.executable_lines) {
      let execLines = this.parson.executable_lines;
      let realCls = [];
      // TODO update executable_lines indent
      for (let cl of codeLines) {
        let executableCl = this.parson.getLineById(cl.id, execLines);
        executableCl.indent = cl.indent;
        realCls.push(executableCl)
      }
      return new LanguageTranslationGrader(this.parson).grade(realCls);
    } else {
      return new VariableCheckGrader(this.parson).grade(codeLines);
    }
  };

  // Grader that will execute student code and Skulpt unittests
  var UnitTestGrader = function(parson) {
    this.parson = parson;
  };
  graders.UnitTestGrader = UnitTestGrader;
  // copy the line number fixer and code-construction from VariableCheckGrader
  UnitTestGrader.prototype.stripLinenumberIfNeeded = VariableCheckGrader.prototype.stripLinenumberIfNeeded;
  UnitTestGrader.prototype._codelinesAsString = VariableCheckGrader.prototype._codelinesAsString;
  // copy the python executor from VariableCheckGrager
  UnitTestGrader.prototype._python_exec = VariableCheckGrader.prototype._python_exec;
  // do the grading
  UnitTestGrader.prototype.grade = function(codeLines) {
    let success = true,
        parson = this.parson,
        unittests = parson.options.unittests,
        studentCodeStr = this._codelinesAsString(codeLines),
        feedbackHtml = "", // HTML to be returned as feedback
        result, execResult, mainmod;

    var executableCode = studentCodeStr + "\n" + unittests;

    // if there is code to add before student code, add it
    if (parson.options.unittest_code_prepend) {
      executableCode = parson.options.unittest_code_prepend + "\n" + executableCode;
    }

    try {
      execResult = this._python_exec(executableCode);
      mainmod = execResult.mainmod;
      // let output = execResult.output;
      result = JSON.parse(mainmod.tp$getattr("_test_result").v);
    } catch (e) {
      result = [{status: "error", _error: e.toString() }];
    }

    // go through the results and generate HTML feedback
    for (var i = 0, l = result.length; i < l; i++) {
      var res = result[i];
      feedbackHtml += '<div class="testcase ' + res.status + '">';
      if (res.status === "error") { // errors in execution
        feedbackHtml += parson.translations.unittest_error(this.stripLinenumberIfNeeded(res._error,
                                                                    parson.options.unittest_code_prepend,
                                                                    studentCodeStr));
        success = false;
      } else { // passed or failed tests
        feedbackHtml += '<span class="msg">' + this.stripLinenumberIfNeeded(res.feedback) + '</span><br />';
        feedbackHtml += 'Expected <span class="expected">' + res.expected +
                  '</span>' + res.test + '<span class="actual">' + res.actual +
                  '</span>';
        if (res.status === "fail") {
          success = false;
        }
      }
      feedbackHtml += '</div>';
    }

    return { html: feedbackHtml, tests: result, success: success };
  };

  // Code "Translating" grader
  var LanguageTranslationGrader = function(parson) {
    this.parson = parson;
  };
  // Add the grader to the list of graders
  graders.LanguageTranslationGrader = LanguageTranslationGrader;
  // add open/close block definitions for pseudocode
  var langBlocks = {};
  LanguageTranslationGrader._languageBlocks = langBlocks;
  // specify the blocks for the pseudo language as a simple example case
  langBlocks.pseudo = {
    open: {
      "^\s*IF.*THEN\s*$": "IF", "^\s*ELSE\s*$":"IF", // IF
      "^\s*WHILE.*DO\s*$": "WHILE", // WHILE
      "^\s*REPEAT.*TIMES\s*$": "REPEAT..TIMES",
      "^\s*REPEAT\s*$": "REPEAT",   // REPEAT ... UNTIL
      "^\s*FOR.*DO\s*$": "FOR",
      "^\s*FOR.*TO.*\s*$": "FOR",
      "^\s*MODULE.*\\)\s*$": "MODULE", "^\s*MODULE.*RETURNS.*$": "MODULE",
      "^\s*DO\s*$": "DO..WHILE"
    },
    close: {
      "^\s*ELSE\s*$": "IF", "^\s*ENDIF\s*$": "IF", // ENDIF
      "^\s*ENDWHILE\s*$": "WHILE",
      "^\s*ENDREPEAT\s*$": "REPEAT..TIMES",
      "^\s*UNTIL.*\s*$": "REPEAT",
      "^\s*ENDFOR\s*$": "FOR",
      "^\s*ENDMODULE\s*$": "MODULE",
      "^\s*WHILE(?!.*DO)": "DO..WHILE"
    }
  };
  langBlocks.java = {
    open: {
      "^.*\{\s*$": "block"
    },
    close: {
      "^.*\}\s*$": "block"
    }
  };
  LanguageTranslationGrader.prototype.grade = function(codeLines) {
    let student_code = this.parson.normalizeIndents(codeLines);

    // Check opening and closing blocks.
    // The block_open and block_close are expected to be maps with regexps as properties and
    // names of blocks as the property values. For example, a pseudocode IF..THEN..ELSE..ENDIF
    // blocks can be defined like this:
    //    open = {"^\s*IF.*THEN\s*$": "IF", "^\s*ELSE\s*$":"IF"};
    //    close = {"^s*ELSE\s*$": "IF", "^\s*ENDIF\s*$": "IF"};
    let open = this.parson.options.block_open,
        close = this.parson.options.block_close,
        blockErrors = [],
        i;
    let progLang = this.parson.options.programmingLang;
    if (progLang && LanguageTranslationGrader._languageBlocks[progLang]) {
      open = $.extend({}, open, LanguageTranslationGrader._languageBlocks[progLang].open);
      close = $.extend({}, close, LanguageTranslationGrader._languageBlocks[progLang].close);
    }

    if (open && close) { // check blocks only if block definitions are given
      let blocks = [],
          prevIndent = 0, // keep track of previous indent inside blocks
          minIndent = 0; // minimum indent needed inside newly opened blocks
      // go through all student code lines
      for (i = 0; i < student_code.length; i++) {
        var isClose = false, // was a new blocks opened on this line
            isOpen = false,  // was a block closed on this line
            item = student_code[i],
            // line = $("#" + item.id).text(), // code of the line
            line = item.getCode(), // code of the line
            topBlock, bO;

        // Check if a proper indentation or the line was found in normalizeIndents
        // -1 will mean no matching indent was found
        if (item.indent < 0) {
          blockErrors.push(this.parson.translations.no_matching(i + 1));
          // $("#" + item.id).addClass("incorrectIndent");
          break; // break on error
        }

        // Go through all block closing regexps and test if they match
        // Some lines can both close and open a block (such as else), so the
        // closing blocks need to be handled first
        for (var blockClose in close) {
          if (new RegExp(blockClose).test(line)) {
            isClose = true;
            topBlock = blocks.pop();
            if (!topBlock) {
              blockErrors.push(this.parson.translations.no_matching_open(i + 1, close[blockClose]));
            } else if (close[blockClose] !== topBlock.name) { // incorrect closing block
              blockErrors.push(this.parson.translations.block_close_mismatch(i + 1, close[blockClose], topBlock.line, topBlock.name));
            } else if (student_code[i].indent !== topBlock.indent) { // incorrect indent
              blockErrors.push(this.parson.translations.no_matching(i + 1));
            }
            prevIndent = topBlock ? topBlock.indent : 0;
            minIndent = 0;
            break; // only one block can be closed on a single line
          }
        }

        // Go through all block opening regexps and test if they match
        for (var blockOpen in open) {
          if (new RegExp(blockOpen).test(line)) {
            isOpen = true;
            bO = {
              name: open[blockOpen],
              indent: student_code[i].indent,
              line: i + 1,
              item: item
            };
            blocks.push(bO);
            prevIndent = 0;
            minIndent = bO.indent;
            break; // only one block can be opened on a single line
          }
        }

        // if not opening or closing a block, check block indentation
        if (!isClose && !isOpen && blocks.length > 0) {
          // indentation should match previous indent if inside block
          // and be greater than the indent of the block opening the block (minIndent)
          if ((prevIndent && student_code[i].indent !== prevIndent) ||
              student_code[i].indent <= minIndent) {
            blockErrors.push(this.parson.translations.no_matching(i + 1));
          }
          prevIndent = student_code[i].indent;
        }
        // if we have errors, clear the blocks and exit from the loop
        if (blockErrors.length > 0) {
          blocks = [];
          break;
        }
      }

      // create errors for all blocks opened but not closed
      for (i = 0; i < blocks.length; i++) {
        blockErrors.push(this.parson.translations.no_matching_close(blocks[i].line, blocks[i].name));
      }
    }
    // if there were errors in the blocks, give feedback and don't execute the code
    if (blockErrors.length > 0) {
      var feedback = "<div class='testcase fail'>",
          fbmsg = "";
      for (i = 0; i < blockErrors.length; i++) {
        fbmsg += blockErrors[i] + "</br>";
      }
      feedback += this.parson.translations.unittest_error(fbmsg);
      feedback += "</div>";
      return { html: feedback, success: false };
    }

    // Replace codelines show with codelines to be executed
    // Get real executable codes with indent
    var codeLines = this._replaceCodelines(student_code);
    // run unit tests or variable check grader
    if (this.parson.options.unittests) {
      return new UnitTestGrader(this.parson).grade(codeLines);
    } else {
      return new VariableCheckGrader(this.parson).grade(codeLines);
    }
  };

  // Replaces codelines in the student's solution with the codelines
  // specified in the executable_code option of the parsons widget.
  // The executable_code option can be an array of lines or a string (in
  // which case it will be split on newline.
  // For each line in the model solution, there should be a matching line
  // in the executable_code.
  LanguageTranslationGrader.prototype._replaceCodelines = function(student_code) {
    let parson = this.parson,
        executableCode = parson.executable_lines;
    let codeLines = [];

    for (let item of student_code) {
      // var ind = parseInt(item.id.replace(parson.id_prefix, ''), 10);
      var ind = item.idx;
      var execCodeLine = executableCode[ind].clone();
      execCodeLine.indent = item.indent;
      execCodeLine.toggleIdxs = item.toggleIdxs;
      execCodeLine.toggleVals = item.toggleVals

      codeLines.push(execCodeLine);
    };
    return codeLines;
  };

  // The "original" grader for giving line based feedback.
  var LineBasedGrader = function(parson) {
    this.parson = parson;
  };

  graders.LineBasedGrader = LineBasedGrader;
  LineBasedGrader.prototype.grade = function(codeLines) {
    var parson = this.parson;
    var student_code = parson.normalizeIndents(codeLines);
    var lines_to_check = Math.min(student_code.length, parson.model_solution.length);
    var errors = [], log_errors = [];
    var incorrectLines = [], studentCodeLineObjects = [];
    var i;
    var wrong_order = false;

    // Find the line objects for the student's code
    for (i = 0; i < student_code.length; i++) {
      studentCodeLineObjects.push(student_code[i].clone());
    }

    // This maps codeline strings to the index, at which starting from 0, we have last
    // found this codeline. This is used to find the best indices for each
    // codeline in the student's code for the LIS computation and, for example,
    // assigns appropriate indices for duplicate lines.
    var lastFoundCodeIndex = {};
    $.each(studentCodeLineObjects, function(index, lineObject) {
    	// find the first matching line in the model solution
    	// starting from where we have searched previously
      let code = lineObject.getCode();
      let i = (typeof(lastFoundCodeIndex[code]) !== 'undefined') ? lastFoundCodeIndex[code]+1 : 0;
    	for (; i < parson.model_solution.length; i++) {
    	  if (parson.model_solution[i].getCode() === code) {
    		  // found a line in the model solution that matches the student's line
    		  lastFoundCodeIndex[code] = i;
          lineObject.lisIgnore = false;
          // This will be used in LIS computation
          lineObject.position = i;
          break;
    	  }
    	}
    	if (i === parson.model_solution.length) {
    	  if (typeof(lastFoundCodeIndex[code]) === 'undefined') {
	    	// Could not find the line in the model solution at all,
	    	// it must be a distractor
	    	// => add to feedback, log, and ignore in LIS computation
	        wrong_order = true;
	        // lineObject.markIncorrectPosition();
	    	  incorrectLines.push(lineObject.origIdx);
	        lineObject.lisIgnore = true;
	      } else {
	        // The line is part of the solution but there are now
	    	// too many instances of the same line in the student's code
	        // => Let's just have their correct position to be the same
	    	// as the last one actually found in the solution.
	        // LIS computation will handle such duplicates properly and
	    	// choose only one of the equivalent positions to the LIS and
	        // extra duplicates are left in the inverse and highlighted as
	    	// errors.
	        // TODO This method will not always give the most intuitive
	    	// highlights for lines to supposed to be moved when there are
	        // several extra duplicates in the student's code.
            lineObject.lisIgnore = false;
            lineObject.position = lastFoundCodeIndex[code];
	      }
    	}
    });

    var lisStudentCodeLineObjects = studentCodeLineObjects.filter(lineObject => !lineObject.lisIgnore);
    var inv = LIS.best_lise_inverse_indices(
      lisStudentCodeLineObjects.map(lineObject => lineObject.position)
    );
    $.each(inv, function(_index, lineObjectIndex) {
    	// Highlight the lines that could be moved to fix code as defined by the LIS computation
      incorrectLines.push(lisStudentCodeLineObjects[lineObjectIndex].origIdx);
    });
    if (inv.length > 0 || incorrectLines.length > 0) {
      wrong_order = true;
      log_errors.push({type: "incorrectPosition", lines: incorrectLines});
    }

    if (wrong_order) {
      errors.push(parson.translations.order());
    }

    // Check the number of lines in student's code
    if (parson.model_solution.length < student_code.length) {
      errors.push(parson.translations.lines_too_many());
      log_errors.push({type: "tooManyLines", lines: student_code.length});
    } else if (parson.model_solution.length > student_code.length){
      errors.push(parson.translations.lines_missing());
      log_errors.push({type: "tooFewLines", lines: student_code.length});
    }

    // Finally, check indent if no other errors
    if (errors.length === 0) {
      for (i = 0; i < lines_to_check; i++) {
        var code_line = student_code[i];
        var model_line = parson.model_solution[i];
        if (
          code_line.indent !== model_line.indent
          && ((!parson.options.first_error_only) || errors.length === 0)
        ) {
          // code_line.markIncorrectIndent();
          errors.push(parson.translations.block_structure(i+1));
          log_errors.push({type: "incorrectIndent", line: (i+1)});
        }
      }
    }

    return {errors: errors, log_errors: log_errors, success: (errors.length === 0)};
  };


  var python_indents = [],
      spaces = "";
  for (var counter = 0; counter < 20; counter++) {
    python_indents[counter] = spaces;
    spaces += "  ";
  }

  var defaultToggleTypeHandlers = {
      boolean: ["True", "False"],
      compop: ["<", ">", "<=", ">=", "==", "!="],
      mathop: ["+", "-", "*", "/"],
      boolop: ["and", "or"],
      range: function($item) {
         var min = parseFloat($item.data("min") || "0"),
             max = parseFloat($item.data("max") || "10"),
             step = parseFloat($item.data("step") || "1"),
             opts = [],
             curr = min;
         while (curr <= max) {
            opts.push("" + curr);
            curr += step;
         }
         return opts;
      }
  };

  // $.extend(true, _, _) + ParsonsCodeline object clone
  var deep_extend = function(target, original) {
    if (Array.isArray(original)) {
      original.forEach(function (item, idx) {
        let newItem;
        if (Array.isArray(item)) {
          newItem = deep_extend([], item);
        } else {
          newItem = deep_extend({}, item);
        }
        target.push(newItem);
      });
    } else if (original instanceof ParsonsCodeline) {
      target = original.clone();
    } else {
      target = $.extend(true, target, original);
    }
    return target;
  }

  // Create a line object skeleton with only code and indentation from
  // a code string of an assignment definition string (see parseCode)
  var ParsonsCodeline = function(codestring, widget) {
    this.widget = widget;
    // TODO escape codestring
    this.code = "";
    this.indent = 0;
    this._toggles = [];
    this.numToggle = 0;
    this.toggleVals = [];
    this.toggleIdxs = [];
    this.isDistractor = false;

    // the original index of the line in the assignment definition string,
    // this is their expected position in solution
    this.origIdx = -1;

    if (codestring) {
      // Consecutive lines to be dragged as a single block of code have strings "\\n" to
      // represent newlines => replace them with actual new line characters "\n"
      let distractorRegex = /#distractor\s*$/;
      this.code = codestring.replace(distractorRegex, "").replace(trimRegexp, "$1").replace(/\\n/g, "\n");
      this.indent = codestring.length - codestring.replace(/^\s+/, "").length;

      if (codestring.match(distractorRegex)) {
        this.isDistractor = true;
        this.indent = -1;
      }

      let toggles = this.code.match(this.widget.toggleRegexp);
      if (toggles) {
        this.numToggle = toggles.length;
        for (let item of toggles) {
          var opts = item.substring(10, item.length - 2).split(widget.options.toggleSeparator);
          this.toggleVals.push(opts);
        }
      }
    }
  };

  // get code with toggle values
  ParsonsCodeline.prototype.getCode = function() {
    let code = this.code;
    if (this.numToggle) {
      var toggles = code.match(this.widget.toggleRegexp);
      for (let idx=0; idx<toggles.length; idx++) {
        if (idx >= this.numToggle) break;
        let toggle = toggles[idx];
        let valIdx = this.toggleIdxs[idx];
        let val = valIdx !== -1 ? this.toggleVals[idx][valIdx] : '??';
        code = code.replace(toggle, val);
      }
    }
    return code;
  }

  // Returns the value of the toggleable element at the given index (0-based)
  ParsonsCodeline.prototype.toggleValue = function(index) {
    if (index < 0 || index >= this._toggles.length) { return undefined; }
    return this._toggles[index].textContent;
  };

  ParsonsCodeline.prototype.clone = function() {
    let new_cl = new ParsonsCodeline();
    Object.assign(new_cl, this);
    return new_cl;
  };
  // expose the type for testing, extending etc
  window.ParsonsCodeline = ParsonsCodeline;

  // Creates a parsons widget. Init must be called after creating an object.
  var ParsonsWidget = function(options) {
	 // Contains line objects of the user-draggable code.
	 // The order is not meaningful (unchanged from the initial state) but
	 // indent property for each line object is updated as the user moves
	 // codelines around. (see parseCode for line object description)
    this.modified_lines = [];
    // contains line objects of distractors (see parseCode for line object description)
    this.extra_lines = [];
    // contains line objects (see parseCode for line object description)
    this.model_solution = [];

    //To collect statistics, feedback should not be based on this
    this.user_actions = [];

    // (optional) executable codes
    this.executable_lines = [];

    //State history for feedback purposes
    this.state_path = [];
    this.states = {};

    var defaults = {
      'x_indent': 50,
      'can_indent': true,
      'feedback_cb': false,
      'first_error_only': true,
      'max_wrong_lines': 10,
      'lang': 'en',
      'toggleSeparator': '::'
    };

    this.options = $.extend({}, defaults, options);
    this.feedback_exists = false;
    this.id_prefix = options['sortableId'] + 'codeline';
    this.toggleRegexp = new RegExp("\\$\\$toggle(" + this.options.toggleSeparator + ".*?)?\\$\\$", "g");

    if (translations.hasOwnProperty(this.options.lang)) {
      this.translations = translations[this.options.lang];
    } else {
      this.translations = translations['en'];
    }

    // translate trash_label and solution_label
    if (!this.options.hasOwnProperty("trash_label")) {
        this.options.trash_label = this.translations.trash_label;
    }
    if (!this.options.hasOwnProperty("solution_label")) {
        this.options.solution_label = this.translations.solution_label;
    }

    if (this.options.hasOwnProperty("executable_code")) {
      let initial_structures = this.parseCode(this.options.executable_code.split("\n"), 0);
      this.executable_lines = initial_structures.solution;
    }

    this.FEEDBACK_STYLES = {
      'correctPosition' : 'correctPosition',
      'incorrectPosition' : 'incorrectPosition',
      'correctIndent' : 'correctIndent',
      'incorrectIndent' : 'incorrectIndent'
    };

    // use grader passed as an option if defined and is a function
    if (this.options.grader && _.isFunction(this.options.grader)) {
      this.grader = new this.options.grader(this);
    } else {
      // initialize the grader
      if (typeof(this.options.unittests) !== "undefined") { /// unittests are specified
        this.grader = new UnitTestGrader(this);
      } else if (typeof(this.options.vartests) !== "undefined") { /// tests for variable values
        this.grader = new VariableCheckGrader(this);
      } else { // "traditional" parson feedback
        this.grader = new LineBasedGrader(this);
      }
    }
  };
  ParsonsWidget._graders = graders;

   ////Public methods

   // Parses an assignment definition given as a string and returns and
   // transforms this into an object defining the assignment with line objects.
   //
   // lines: A string that defines the solution to the assignment and also
   //   any possible distractors
   // max_distractrors: The number of distractors allowed to be included with
   //   the lines required in the solution
  ParsonsWidget.prototype.parseCode = function(lines, max_distractors) {
    let distractors = [],
        indented = [],
        widgetData = [],
        lineObject,
        errors = [],
        that = this;
     // Create line objects out of each codeline and separate
     // lines belonging to the solution and distractor lines
     // Fields in line objects:
     //   code: a string of the code, may include newline characters and
     //     thus in fact represents a block of consecutive lines
     //   indent: indentation level, -1 for distractors
     //   distractor: boolean whether this is a distractor
     //   orig: the original index of the line in the assignment definition string,
     //     for distractors this is not meaningful but for lines belonging to the
     //     solution, this is their expected position
    $.each(lines, function(index, item) {
      lineObject = new ParsonsCodeline(item, that);
      lineObject.origIdx = index;
      if (lineObject.isDistractor) {
        if (lineObject.code.length > 0) {
          distractors.push(lineObject);
        }
      } else {
        // This line is part of the solution
        if (lineObject.code.length > 0) {
          indented.push(lineObject);
        }
      }
    });

    let normalized = this.normalizeIndents(indented);
    $.each(normalized, function(index, item) {
      if (item.indent < 0) {
        // Indentation error
        errors.push(this.translations.no_matching(normalized.origIdx));
      }
      widgetData.push(item);
    });

    // Add ids to all codeline objects
    let id_prefix = this.id_prefix;
    let codelines = [...widgetData, ...distractors];
    for (let idx = 0; idx < codelines.length; idx++) {
      codelines[idx].id = id_prefix + idx;
      codelines[idx].idx = idx;
    };

    // Remove extra distractors if there are more alternative distrators
    // than should be shown at a time
    //  var permutation = this.getRandomPermutation(distractors.length);
    let selected_distractors = _.sample(distractors, max_distractors);
    for (let item of selected_distractors) {
       widgetData.push(item);
    }

    let widgetInitial = deep_extend([], widgetData);
    for (let item of widgetInitial) {
      item.indent = 0;
    }

    return {
      // an array of line objects specifying  the solution
      solution: deep_extend([], normalized),

      // an array of line objects specifying the requested number
      // of distractors (not all possible alternatives)
      distractors: deep_extend([], selected_distractors),

      // an array of line objects specifying the initial code arrangement
      // given to the user to use in constructing the solution
      widgetInitial: widgetInitial,
      errors: errors
    };
  };

  ParsonsWidget.prototype.init = function(text) {
    // TODO: Error handling, parseCode may return errors in an array in property named errors.
    let initial_structures = this.parseCode(text.split("\n"), this.options.max_wrong_lines);
    this.model_solution = initial_structures.solution;
    this.extra_lines = initial_structures.distractors;
    this.modified_lines = initial_structures.widgetInitial;
  };

  ParsonsWidget.prototype.addLogEntry = function(entry) {
    var state, previousState;
    var logData = {
      time: new Date(),
      // output: this.solutionHash(),
      type: "action"
    };

    // if (this.options.trashId) {
    //   logData.input = this.trashHash();
    // }

    if (entry.target) {
      entry.target = entry.target.replace(this.id_prefix, "");
    }

    state = logData.output;
    $.extend(logData, entry);
    this.user_actions.push(logData);

    // Updating the state history
    if(this.state_path.length > 0) {
      previousState = this.state_path[this.state_path.length - 1];
      this.states[previousState] = logData;
    }

    // Add new item to the state path only if new and previous states are not equal
    if (this.state_path[this.state_path.length - 1] !== state) {
      this.state_path.push(state);
    }
    // callback for reacting to actions
    if ($.isFunction(this.options.action_cb)) {
      this.options.action_cb.call(this, logData);
    }
  };

  // Get a line object by the full id including id prefix
  // (see parseCode for description of line objects)
  ParsonsWidget.prototype.getLineById = function(id, targetGroup=null) {
    var index = -1;
    if (!targetGroup) {
      targetGroup = this.modified_lines;
    }
    for (var i = 0; i < targetGroup.length; i++) {
      if (targetGroup[i].id == id) {
        index = i;
        break;
      }
    }
    return targetGroup[index];
  };

   // Check and normalize code indentation.
   // Does not use the current object (this) to make changes to
   // the parameter.
   // Returns a new array of line objects whose indent fields' values
   // may be different from the argument. If indentation does not match,
   // i.e. code is malformed, value of indent may be -1.
   // For example, the first line may not be indented.
  ParsonsWidget.prototype.normalizeIndents = function(lines) {
    var normalized = [];
    var new_line;
    var match_indent = function(index) {
      //return line index from the previous lines with matching indentation
      for (var i = index-1; i >= 0; i--) {
        if (lines[i].indent == lines[index].indent) {
          return normalized[i].indent;
        }
      }
      return -1;
    };
    for ( var i = 0; i < lines.length; i++ ) {
      //create shallow copy from the line object
      // TODO ?
    new_line = lines[i].clone();
      if (i === 0) {
        new_line.indent = 0;
        if (lines[i].indent !== 0) {
          new_line.indent = -1;
        }
      } else if (lines[i].indent == lines[i-1].indent) {
        new_line.indent = normalized[i-1].indent;
      } else if (lines[i].indent > lines[i-1].indent) {
        new_line.indent = normalized[i-1].indent + 1;
      } else {
        // indentation can be -1 if no matching indentation exists, i.e. IndentationError in Python
        new_line.indent = match_indent(i);
      }
      normalized[i] = new_line;
    }
    return normalized;
  };

  ParsonsWidget.prototype.getFeedback = function(data) {
    let codeLines = [];
    // update indent
    // for (var clId in data){
    for (var clData of data){
      let id = this.id_prefix + clData.idx;
      let cl = this.getLineById(id);
      if (!cl) continue;
      cl = cl.clone();
      cl.indent = clData.indent;
      cl.toggleIdxs = clData.toggleIdxs;
      codeLines.push(cl);
    }

    // let codeLines = this.getModifiedCode(Object.keys(data));
     this.feedback_exists = true;
     var fb = this.grader.grade(codeLines);

    // TODO use different way to detect this
     // log the feedback and return; based on the type of grader
     if ('html' in fb) { // unittest/vartests type feedback
       this.addLogEntry({type: "feedback", tests: fb.tests, success: fb.success});
       return { feedback: fb.html, success: fb.success };
     } else {
       this.addLogEntry({type: "feedback", errors: fb.log_errors, success: fb.success});
       return fb.errors;
     }
   };

  window['ParsonsWidget'] = ParsonsWidget;


  // TODO support predefined order + predefined indent
  var ParsonsJS = function(config) {
    // do basic dom operation
    // get sortableId/ trashId/ turtle canvas?

    this.parson = new ParsonsWidget(config);
    this.codeStr = config.codeStr;
    this.order = config.order;
    // when get feedback is triggered. get the item ids in order, send item ids
    // to ParsonsWidget
  }

  ParsonsJS.prototype.init = function() {
    this.parson.init(this.codeStr);
  }

  ParsonsJS.prototype.initUI = function() {
    this.init();
    if (this.order) {
      this.initListItemFromOrder(this.order);
    } else {
      this.shuffleLines();
    }
  }

  ParsonsJS.prototype.codeLineToHTML = function(codeline) {
    // TODO add toggle ele here
    let code = this.codeLineAddToggles(codeline);
    return '<li id="' + codeline.id + '" class="prettyprint lang-py" data-id="' + codeline.idx + '">' + code + '<\/li>';
  };

  ParsonsJS.prototype.codeLinesToHTML = function(codelineIDs, destinationID) {
    var lineHTML = [];
    for(var id in codelineIDs) {
      var line = this.parson.getLineById(codelineIDs[id]);
      lineHTML.push(this.codeLineToHTML(line));
    }
    return '<ul id="ul-' + destinationID + '">' + lineHTML.join('') + '</ul>';
  };

  ParsonsJS.prototype.getIndentNew = function($item, leftPosDiff) {
    let parson = this.parson;
    let indentCurr = $item.prop("data-indent");
    var indentNew = parson.options.can_indent ? indentCurr + Math.floor(leftPosDiff / parson.options.x_indent) : 0;
    indentNew = Math.max(0, indentNew);
    return indentNew;
  };

  ParsonsJS.prototype.updateHTMLIndent = function($item, indNew) {
    $item.css("margin-left", this.parson.options.x_indent * indNew + "px");
    $item.prop('data-indent', indNew);
  };

  ParsonsJS.prototype.setToggleVal = function($codeline, toggleIdxs) {
    $codeline.find('.jsparson-toggle').each(function(idx) {
      let $toggle = $(this),
          tIdx = toggleIdxs[idx],
          choices = $toggle.data("jsp-options");

      if (tIdx < 0 || !choices || tIdx > choices.length) {
        return
      }
      let newVal = choices[tIdx];
      $toggle.text(newVal);
      $toggle.prop('data-idx', tIdx);
    })
  }

  ParsonsJS.prototype.initSortableBox = function($box) {
    let that = this;
    $box.find('li').each(function(idx) {
      $(this).prop('data-indent', 0);
    })

    // init toggles
    let $toggles = $box.find('.jsparson-toggle');
    $toggles.prop('data-idx', -1);
    $toggles.click(function () {
      let $toggle = $(this),
          curVal = $toggle.text(),
          choices = $toggle.data("jsp-options"),
          newIdx = (choices.indexOf(curVal) + 1) % choices.length,
          newVal = choices[newIdx],
          $parent = $toggle.parent("li");

      // change the shown toggle element
      $toggle.text(newVal);
      $toggle.prop('data-idx', newIdx);

      // log the event
      that.parson.addLogEntry({
        type: "toggle",
        oldvalue: curVal,
        newvalue: newVal,
        target: $parent[0].id,
        toggleindex: $parent.find(".jsparson-toggle").index($toggle)
      });
    })
  }

  ParsonsJS.prototype.createHTMLFromLists = function(solutionIDs, trashIDs) {
    let parson = this.parson;
    let options = parson.options;
    var html;
    let $targetBox = $("#" + options.sortableId);

    if (options.trashId) {
      html = (options.trash_label ? '<p>' + options.trash_label + '</p>' : '')
        + this.codeLinesToHTML(trashIDs, options.trashId);
      let $trashBox = $("#" + options.trashId);
      $trashBox.html(html);
      this.initSortableBox($trashBox);

      html = (options.solution_label ? '<p>' + options.solution_label + '</p>' : '')
        + this.codeLinesToHTML(solutionIDs, options.sortableId);
      // $("#" + options.sortableId).html(html);
      // let $targetBox = $("#" + options.sortableId);
      $targetBox.html(html);
    } else {
      html = this.codeLinesToHTML(solutionIDs, options.sortableId);
      $targetBox.html(html);
    }
    this.initSortableBox($targetBox);

    var that = this;
    var $sortable = $("#ul-" + options.sortableId).sortable({
        start : function() {
          // that.clearFeedback();
        },
        stop : function(event, ui) {
          if ($(event.target)[0] != ui.item.parent()[0]) {
            return;
          }
          let $item = ui.item;
          let itemId = $item.id;
          let posDiff = ui.position.left - ui.item.parent().position().left;
          // that.updateIndent(indDiff, itemId);
          let indNew = that.getIndentNew($item, posDiff);
          that.updateHTMLIndent($item, indNew);
          parson.addLogEntry({type: "moveOutput", target: itemId}, true);
        },
        receive : function(event, ui) {
          let $item = ui.item;
          let itemId = $item.id;
          let posDiff = ui.position.left - ui.item.parent().position().left;
          // that.updateIndent(indDiff, itemId);
          // that.updateHTMLIndent(itemId);
          let indNew = that.getIndentNew($item, posDiff);
          that.updateHTMLIndent($item, indNew);

          parson.addLogEntry({type: "addOutput", target: itemId}, true);
        },
        grid : parson.options.can_indent ? [parson.options.x_indent, 1 ] : false
    });

    // $sortable.addClass("output");
    if (options.trashId) {
      var $trash = $("#ul-" + options.trashId).sortable({
        start: function() {
          // that.clearFeedback();
        },
        receive: function(event, ui) {
          // that.getLineById(ui.item[0].id).indent = 0;
          // that.updateHTMLIndent(ui.item[0].id);
          that.updateHTMLIndent(ui.item, 0);
          parson.addLogEntry({type: "removeOutput", target: ui.item.id}, true);
        },
        stop: function(event, ui) {
          if ($(event.target)[0] != ui.item.parent()[0]) {
            // line moved to output and logged there
            return;
          }
          parson.addLogEntry({type: "moveInput", target: ui.item.id}, true);
        }
      });
      $trash.sortable('option', 'connectWith', $sortable);
      $sortable.sortable('option', 'connectWith', $trash);
    }

    // Log the original codelines in the exercise in order to be able to
    // match the input/output hashes to the code later on. We need only a
    // few properties of the codeline objects

    // TODO what is this?
    // var bindings = [];
    // for (var i = 0; i < this.modified_lines.length; i++) {
    //   var line = this.modified_lines[i];
    //   bindings.push({code: line.code, distractor: line.distractor})
    // }
    // this.addLogEntry({type: 'init', time: new Date(), bindings: bindings});
  };

  ParsonsJS.prototype.codeLineAddToggles = function(codeLine) {
    let toggleRegexp = this.parson.toggleRegexp;
    let toggleSeparator = this.parson.options.toggleSeparator;
    let toggles = codeLine.code.match(toggleRegexp);
    let html = codeLine.code;

    if (toggles) {
      for (let toggle of toggles) {
        let opts = toggle.substring(10, toggle.length - 2).split(toggleSeparator);
        html = html.replace(
          toggle,
          "<span class='jsparson-toggle' data-jsp-options='"
          + JSON.stringify(opts).replace("<", "&lt;")
          + "'></span>"
        );
      }
    }
    return html
  }

  ParsonsJS.prototype.getRandomPermutation = function(n) {
    return _.shuffle(_.range(n));
  };

  ParsonsJS.prototype.shuffleLines = function(idlist=null) {
    let parson = this.parson;
    // var permutation = (parson.options.permutation ? parson.options.permutation : this.getRandomPermutation)(parson.modified_lines.length);
    if (!idlist) {
      let permutation = this.getRandomPermutation(parson.modified_lines.length);
      idlist = [];
      for(var idx of permutation) {
          idlist.push(parson.modified_lines[idx].id);
      }
    }

    if (parson.options.trashId) {
        this.createHTMLFromLists([], idlist);
    } else {
        this.createHTMLFromLists(idlist, []);
    }
  }

  ParsonsJS.prototype.initListItemFromOrder = function(order) {
    let id_prefix = this.parson.id_prefix;
    for (let item of order) {
      item.id = id_prefix + item.idx;
    }
    let idlist = order.map(item => item.id);
    this.shuffleLines(idlist);

    for (let clData of order) {
      let $item = $('#' + clData.id);
      if (clData.indent) {
        this.updateHTMLIndent($item, clData.indent);
      }

      if (clData.toggleIdxs) {
        this.setToggleVal($item, clData.toggleIdxs);
      }
    }
  }

  ParsonsJS.prototype.getFeedback = function() {
    // get codeLineIds from DOM
    let codeLineIds = $("#ul-" + this.parson.options.sortableId).sortable('toArray');

    // get order + indent
    let data = [];
    for (let idx = 0; idx < codeLineIds.length; idx++) {
      let clId = codeLineIds[idx];
      let $cl = $('#' + clId);
      let toggleIdxs = [];
      $cl.find('.jsparson-toggle').each(function () {
        let $toggle = $(this),
            valIdx = $toggle.prop('data-idx');
        toggleIdxs.push(valIdx);
      })

      data.push({
        idx: $cl.data('id'),
        indent: $cl.prop('data-indent'),
        toggleIdxs: toggleIdxs
      })
    }
    let fb = this.parson.getFeedback(data);
    return fb;
  };

  window['ParsonsJS'] = ParsonsJS;

// allows _ and $ to be modified with noconflict without changing the globals
// that parsons uses
})($,_);
