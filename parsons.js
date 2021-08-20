'use strict';
(function($, _) { // wrap in anonymous function to not show some helper variables
  const LOG_MSG = {
    ORDER: {
      id: 1,
      msg: 'Code fragments in your program are wrong, or in wrong order. This can be fixed by moving, removing, or replacing the code fragments.'
    },
    LINE_MISSING: {
      id: 2,
      msg: 'Your program has too few code fragments.'
    },
    LINE_TOO_MANY: {
      id: 3,
      msg: 'our program has too many code fragments.'
    },
    NO_MATCHING: {
      id: 4,
      msg: 'Based on language syntax, the code fragment is not correctly indented.'
    },
    NO_MATCHING_OPEN: {
      id: 5,
      msg: 'The block never started.'
    },
    NO_MATCHING_CLOSE: {
      id: 6,
      msg: 'Block not ended properly'
    },
    blockClose_MISMATCH: {
      id: 7,
      msg: 'Block mismatched.'
    },
    BLOCK_STRUCTURE: {
      id: 8,
      msg: 'The code fragment belongs to a wrong block (i.e. indentation).'
    },
    UNITTEST_ERR: {
      id: 9,
      msg: 'Error in parsing/executing your program'
    },
    UNITTEST_ASSERTION_SUC: {
      id: 10,
      msg: 'Unittest assertion passed'
    },
    UNITTEST_ASSERTION_ERR: {
      id: 11,
      msg: 'Unittest assertion failed'
    },
    UNITTEST_OUTPUT_ASSERTION: {
      id: 12,
      msg: 'Actual output is not equal to the expected output'
    },
    VARIABLETEST_ASSERTION_SUC: {
      id: 14,
      msg: 'Variable test assertion passed'
    },
    VARIABLETEST_ASSERTION_ERR: {
      id: 15,
      msg: 'Variable test assertion failed'
    },
  }

  let _pyIndents = [],
  spaces = '';
  for (let counter = 0; counter < 20; counter++) {
    _pyIndents[counter] = spaces;
    spaces += '  ';
  }
  const PYTHON_INDENTS = _pyIndents;

  let defaultToggleTypeHandlers = {
    boolean: ['True', 'False'],
    compop: ['<', '>', '<=', '>=', '==', '!='],
    mathop: ['+', '-', '*', '/'],
    boolop: ['and', 'or'],
    range: function($item) {
        let min = parseFloat($item.data('min') || '0'),
            max = parseFloat($item.data('max') || '10'),
            step = parseFloat($item.data('step') || '1'),
            opts = [],
            curr = min;
        while (curr <= max) {
          opts.push('' + curr);
          curr += step;
        }
        return opts;
    }
  };

  // specify the blocks for the pseudo language as a simple example case
  const langBlocks = {
    pseudo: {
      open: {
        '^\s*IF.*THEN\s*$': 'IF', '^\s*ELSE\s*$':'IF', // IF
        '^\s*WHILE.*DO\s*$': 'WHILE', // WHILE
        '^\s*REPEAT.*TIMES\s*$': 'REPEAT..TIMES',
        '^\s*REPEAT\s*$': 'REPEAT',   // REPEAT ... UNTIL
        '^\s*FOR.*DO\s*$': 'FOR',
        '^\s*FOR.*TO.*\s*$': 'FOR',
        '^\s*MODULE.*\\)\s*$': 'MODULE', '^\s*MODULE.*RETURNS.*$': 'MODULE',
        '^\s*DO\s*$': 'DO..WHILE'
      },
      close: {
        '^\s*ELSE\s*$': 'IF', '^\s*ENDIF\s*$': 'IF', // ENDIF
        '^\s*ENDWHILE\s*$': 'WHILE',
        '^\s*ENDREPEAT\s*$': 'REPEAT..TIMES',
        '^\s*UNTIL.*\s*$': 'REPEAT',
        '^\s*ENDFOR\s*$': 'FOR',
        '^\s*ENDMODULE\s*$': 'MODULE',
        '^\s*WHILE(?!.*DO)': 'DO..WHILE'
      }
    },
    java: {
      open: {
        '^.*\{\s*$': 'block'
      },
      close: {
        '^.*\}\s*$': 'block'
      }
    }
  };

  // $.extend(true, _, _) + ParsonsCodeline object clone
  let deepExtend = function(target, original) {
    if (Array.isArray(original)) {
      original.forEach(function (item, _) {
        let newItem;
        if (Array.isArray(item)) {
          newItem = deepExtend([], item);
        } else {
          newItem = deepExtend({}, item);
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

  //Return executable code in one string
  let codelinesAsString = function(codeLines) {
    let executableCode = '';
    for (let codeLine of codeLines) {
      // split codeblocks on br elements
      let lines = codeLine.code.split(/<br\s*\/?>/);

      // go through all the lines
      for (let line of lines) {
        // add indents and get the text for the line (to remove the html tags)
        executableCode += PYTHON_INDENTS[codeLine.indent] + stripHtml(line) + '\n';
      }
    };
    return executableCode;
  };

  // Fix or strip line numbers in the (error) message
  // Basically removes the number of lines in prependCode from the line number shown.
  let stripLinenumberIfNeeded = function(msg, prependCode, studentCode) {
    let lineNbrRegexp = /.*on line ([0-9]+).*/;
    // function that fixes the line numbers in student feedback
    let match = msg.match(lineNbrRegexp);
    if (match) {
      let lineNo = parseInt(match[1], 10),
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

  // Executes the given Python code and returns an object with two properties:
  //  mainmod: the result of Skulpt importMainWithBody call with the given code
  //  output: the output of the program
  // Note, that the Skulpt execution can throw an exception, which will not be handled
  // by this function, so the caller should take care of that.
  let pythonExec = function(code, usePy3=false, execLimit=2500) {
    let output = '';
    // function for reading python imports with skulpt
    function builtinRead(x) {
      if (typeof Sk.builtinFiles === 'undefined' || typeof Sk.builtinFiles['files'][x] === 'undefined')
        throw 'File not found: "' + x + '"';
      return Sk.builtinFiles['files'][x];
    }
    // configure Skulpt
    Sk.execLimit = execLimit || 2500; // time limit for the code to run
    Sk.configure({
        output: function(str) { output += str; },
        python3: usePy3 || false,
        read: builtinRead
    });
    return {mainmod: Sk.importMainWithBody('<stdin>', false, code), output: output};
  };

  // Executes the given code using Skulpt and returns an object with variable
  // values of the variables given in the variables array.
  // Possible errors will be in the _error property of the returned object.
  // Output of the code will be in _output property of the result.
  // Example: this._variablesAfterExecution('x=0\ny=2\nprint x', ['x', 'y'])
  //    will return object {'x': 0, 'y': 2, '_output': '0'}
  let variablesAfterExecution = function(code, variables, options) { // TODO
    let output = '',
      execResult, mainmod,
      result = {'variables': {}},
      varname;
    try {
      execResult = pythonExec(code, options.python3, options.execLimit);
    } catch (e) {
      return {'_output': output, '_error': '' + e};
    }
    mainmod = execResult.mainmod;
    for (let i = 0; i < variables.length; i++) {
      varname = variables[i];
      result.variables[varname] = mainmod.tp$getattr(varname);
    }
    result._output = execResult.output;
    return result;
  };

  // Formats a JavaScript variable to the corresponding Python value *and*
  // formats a Skulpt variable to the corresponding Python value
  let formatVariableValue = function(varValue) {
    let varType = typeof varValue;
    if (varType === 'undefined' || varValue === null) {
      return 'None';
    } else if (varType === 'string') { // show strings in quotes
      return '"' + varValue + '"';
    } else if (varType === 'boolean') { // Python booleans with capital first letter
      return varValue ? 'True' : 'False';
    } else if (Array.isArray(varValue)) { // JavaScript arrays
      return '[' + varValue.join(', ') + ']';
    } else if (varType === 'object' && varValue.tp$name === 'number') { // Python numbers
      return varValue.v;
    } else if (varType === 'object' && varValue.tp$name === 'NoneType') { // None
      return 'None';
    } else if (varType === 'object' && varValue.tp$name === 'bool') { // Python strings
      return varValue.v ? 'True' : 'False';
    } else if (varType === 'object' && varValue.tp$name === 'str') { // Python strings
      return '"' + varValue.v + '"';
    } else if (varType === 'object' && varValue.tp$name === 'list') { // Python lists
      return '[' + varValue.v.join(', ') + ']';
    } else {
      return varValue;
    }
  };

  let formatLogMsg = function (logMsg, data) {
    return Object.assign({}, data, logMsg);
  }

  let stripHtml = function (str) {

    let tmp = document.createElement('div');
    tmp.innerHTML = str;
    let rst = tmp.textContent || tmp.innerText || '';
    return rst;
  }

  // Grader that will execute the code and check variable values after that
  // Expected and supported options:
  //  - vartests (required): array of variable test objects
  // Each variable test object can/must have the following properties:
  //  - initcode: code that will be prepended before the learner solution code
  //  - finalcode: code that will be appended after the learner solution code
  //  - message (required): a textual description of the test, shown to learner
  // Properties specifying what is tested:
  //  - variables: an object with properties for each variable name to
  //                          be tested; the value of the property is the expected
  //                          value
  // or
  //  - variable: a variable name to be tested
  //  - expected: expected value of the variable after code execution

  class GraderBase {
    constructor(parson) {
      this.parson = parson;
    }

    grade(codeLines) {
      return {}
    }
  }

  // The 'original' grader for giving line based feedback.
  class LineBasedGrader extends GraderBase {
    constructor(parson) {
      super(parson);
    }

    grade(codeLines) {
      let parson = this.parson;
      let studentCodes = parson.normalizeIndents(codeLines);
      let linesToCheck = Math.min(studentCodes.length, parson.modelSolution.length);
      let errors = [], incorrectLines = [], incorrectClIds = [];
      let studentCodeLineObjects = [];
      let wrongOrder = false;

      // Find the line objects for the student's code
      for (let code of studentCodes) {
        studentCodeLineObjects.push(code.clone());
      }

      // This maps codeline strings to the index, at which starting from 0, we have last
      // found this codeline. This is used to find the best indices for each
      // codeline in the student's code for the LIS computation and, for example,
      // assigns appropriate indices for duplicate lines.
      let lastFoundCodeIndex = {};
      for (let lineObject of studentCodeLineObjects) {
        // find the first matching line in the model solution
        // starting from where we have searched previously
        let code = lineObject.code;
        let lastIdx = lastFoundCodeIndex[code];
        let idx = (typeof lastIdx !== 'undefined') ? lastIdx + 1 : 0;
        for (; idx < parson.modelSolution.length; idx++) {
          if (parson.modelSolution[idx].code === code) {
            // found a line in the model solution that matches the student's line
            lastIdx = idx;
            lineObject.lisIgnore = false;
            // This will be used in LIS computation
            lineObject.position = idx;
            break;
          }
        }
        if (idx === parson.modelSolution.length) {
          if (typeof lastIdx === 'undefined') {
            // Could not find the line in the model solution at all,
            // it must be a distractor
            // => add to feedback, log, and ignore in LIS computation
            wrongOrder = true;
            lineObject.lisIgnore = true;

            // incorrectLines.push(lineObject.origIdx);
            incorrectClIds.push(lineObject.id);
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
            lineObject.position = lastIdx;
          }
        }
      };

      let lisStudentCodeLineObjects = studentCodeLineObjects.filter(lineObject => !lineObject.lisIgnore);
      let inv = LIS.best_lise_inverse_indices(
        lisStudentCodeLineObjects.map(lineObject => lineObject.position)
      );
      for (let lineObjectIndex of inv) {
        // Highlight the lines that could be moved to fix code as defined by the LIS computation
        // incorrectLines.push(lisStudentCodeLineObjects[lineObjectIndex].origIdx);
        let cl = lisStudentCodeLineObjects[lineObjectIndex];
        incorrectClIds.push(cl.id);
      };

      if (inv.length > 0 || incorrectLines.length > 0) {
        wrongOrder = true;
      }

      if (wrongOrder) {
        let expectedOrder = parson.modelSolution.map(cl => cl.id),
            actualOrder = studentCodes.map(cl => cl.id);
        errors.push(formatLogMsg(LOG_MSG.ORDER, {
          segmentIds: incorrectClIds,
          expectedVal: expectedOrder,
          actualVal: actualOrder
        }));
      }

      // Check the number of lines in student's code
      let expectedSize = parson.modelSolution.length;
      let actualSize = studentCodes.length;
      if (expectedSize < actualSize) {
        errors.push(formatLogMsg(LOG_MSG.LINE_TOO_MANY, {
          expectedVal: expectedSize,
          actualVal: actualSize
        }));
      } else if (expectedSize > actualSize){
        errors.push(formatLogMsg(LOG_MSG.LINE_MISSING, {
          expectedVal: expectedSize,
          actualVal: actualSize
        }));
      }

      // Finally, check indent if no other errors
      if (errors.length === 0) {
        for (let idx = 0; idx < linesToCheck; idx++) {
          let cl = studentCodes[idx];
          let expectedIndent = parson.modelSolution[idx].indent;
          let actualIndent = cl.indent;
          if (
            actualIndent !== expectedIndent
            && ((!parson.options.firstErrorOnly) || errors.length === 0)
          ) {
            errors.push(formatLogMsg(LOG_MSG.BLOCK_STRUCTURE, {
              segmentIds: [cl.id],
              expectedVal: expectedIndent,
              actualVal: actualIndent
            }));
          }
        }
      }

      return {
        success: errors.length === 0,
        errors: errors
      };
    };
  }


  class VariableCheckGrader extends GraderBase {
    constructor(parson) {
      super(parson);
    };

    grade(codeLines) {
      let parson = this.parson,
          options = parson.options,
          passedTests = [],
          failedTests = [];

      for (let testdata of options.vartests) {
        let studentCodes = codelinesAsString(codeLines);
        let executableCode = (testdata.initcode || '') + '\n' + studentCodes + '\n' + (testdata.finalcode || '');
        let variables, expectedVals;

        if ('variables' in testdata) {
          variables = _.keys(testdata.variables);
          expectedVals = testdata.variables;
        } else {
          variables = [testdata.variable];
          expectedVals = {};
          expectedVals[testdata.variable] = testdata.expected;
        }

        let res = variablesAfterExecution(executableCode, variables, options);
        let logData = {
              code: testdata.initcode,
              detail: testdata.message
            },
            expectedVal,
            actualVal;

        if ('_error' in res) {
          failedTests.push(formatLogMsg(LOG_MSG.UNITTEST_ERROR, logData));
        } else {
          for (let j = 0; j < variables.length; j++) {
            let variable = variables[j],
                variableSuc;
            if (variable === '__output') { // checking output of the program
              expectedVal = expectedVals[variable];
              actualVal = res._output;
              variableSuc = (actualVal == expectedVal); // should we do a strict test??
            } else {
              expectedVal = formatVariableValue(expectedVals[variable]);
              actualVal = formatVariableValue(res.variables[variable]);
              variableSuc = (actualVal == expectedVal);  // should we do a strict test??
            }

            logData.expectedVal = expectedVal;
            logData.actualVal = actualVal;

            if(variableSuc) {
              passedTests.push(formatLogMsg(LOG_MSG.VARIABLETEST_ASSERTION_SUC, logData));
            } else {
              failedTests.push(formatLogMsg(LOG_MSG.VARIABLETEST_ASSERTION_ERR, logData));
            }
          }
        }
      };
      return {
        success: failedTests.length === 0,
        failedTests: failedTests,
        passedTests: passedTests
      }
    };

  }

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
  // If the executableCode option is also specified, the code on each line of that option will
  // be executed instead of the code in the student constructed lines. Note, that the student
  // code should use the variable myTurtle for commands to control the turtle in order for the
  // grading to work.
  class TurtleGrader extends GraderBase {
    constructor (parson) {
      super(parson);
      let options = parson.options;

      // execute the model solution turtlet path to have the target 'picture' visible in the
      // beginning
      let modelCommands = this._executeTurtleModel();

      // specify variable tests for the commands executed by the student turtlet and the model
      let penDown = typeof options.turtlePenDown === 'boolean' ? options.turtlePenDown : true;
      let vartests = [{
        initcode: 'import parsonturtle\nmyTurtle = parsonturtle.ParsonTurtle()\n'
                  + 'myTurtle.speed(0.3)\nmyTurtle.pensize(3, False)\n'
                  + (penDown ? '' : 'myTurtle.up()\n'), // set the state of the pen
        finalcode: (options.turtleTestCode ? options.turtleTestCode : '')
                   + '\ncommands = myTurtle.commands()\npass',
        message: '',
        variables: {
          commands: modelCommands
        }
      }];
      // set the vartests in the parson options
      options.vartests = vartests;
    }

    // Execute the model turtlet code
    _executeTurtleModel() {
      let options = this.parson.options;
      let code = 'import parsonturtle\nmodelTurtle = parsonturtle.ParsonTurtle()\n'
                 + 'modelTurtle.color(160, 160, 160, False)\n'
                 + options.turtleModelCode
                 + '\ncommands = modelTurtle.commands()\n';
      Sk.canvas = options.turtleModelCanvas || 'modelCanvas';
      let result = variablesAfterExecution(code, ['commands'], options);
      if (!result.variables || !result.variables.commands || !result.variables.commands.v) {
        return 'None';
      }
      return result.variables.commands.v;
    };

    // grade the student solution
    grade(codeLines) {
      // set the correct canvas where the turtle should draw
      Sk.canvas = this.parson.options.turtleStudentCanvas || 'studentCanvas';
      // Pass the grading on to either the LangTranslationGrader or VariableChecker
      if (this.parson.executableLines) {
        let execLines = this.parson.executableLines;
        let realCls = [];
        // TODO update executableLines indent
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

  }


  // Grader that will execute student code and Skulpt unittests
  class UnitTestGrader extends GraderBase {
    constructor(parson) {
      super(parson);
    }

    grade(codeLines) {
      let parson = this.parson,
          options = parson.options,
          unittests = parson.options.unittests,
          studentCodeStr = codelinesAsString(codeLines),
          passedTests = [],
          failedTests = [];
      let result, execResult, mainmod;
      let executableCode = studentCodeStr + '\n' + unittests;

      // if there is code to add before student code, add it
      if (parson.options.unittestCodePrepend) {
        executableCode = parson.options.unittestCodePrepend + '\n' + executableCode;
      }

      try {
        execResult = pythonExec(executableCode, options.python3, options.execLimit);
        mainmod = execResult.mainmod;
        result = JSON.parse(mainmod.tp$getattr('_test_result').v);
      } catch (e) {
        result = [{status: 'error', _error: e.toString() }];
      }

      // go through the results and generate HTML feedback
      for (let res of result) {
        if (res.status === 'error') { // errors in execution
          failedTests.push(formatLogMsg(LOG_MSG.UNITTEST_ERR, {
            detail: stripLinenumberIfNeeded(
              res._error,
              parson.options.unittestCodePrepend,
              studentCodeStr
            )
          }))
        } else {
          // passed or failed tests
          let logData = {
            expectedVal: res.expected,
            actualVal: res.actual,
            code: res.test,
            detail: stripLinenumberIfNeeded(res.feedback)
          }

          if (res.status === 'fail') {
            failedTests.push(formatLogMsg(LOG_MSG.UNITTEST_ASSERTION_ERR, logData))
          } else {
            passedTests.push(formatLogMsg(LOG_MSG.UNITTEST_ASSERTION_SUC, logData))
          }
        }
      }

      return {
        success: failedTests.length === 0,
        failedTests: failedTests,
        passedTests: passedTests
      }
    }
  }


  class LanguageTranslationGrader extends GraderBase {
    static _languageBlocks = langBlocks;

    constructor(parson) {
      super(parson);
    }

    // Replaces codelines in the student's solution with the codelines
    // specified in the executableCode option of the parsons widget.
    // The executableCode option can be an array of lines or a string (in
    // which case it will be split on newline.
    // For each line in the model solution, there should be a matching line
    // in the executableCode.
    _replaceCodelines(studentCodes) {
      let executableCode = this.parson.executableLines;
      let codeLines = [];

      for (let item of studentCodes) {
        let execCodeLine = executableCode[item.idx].clone();
        execCodeLine.indent = item.indent;
        execCodeLine.toggleIdxs = item.toggleIdxs;
        execCodeLine.toggleVals = item.toggleVals
        codeLines.push(execCodeLine);
      };
      return codeLines;
    };

    grade(codeLines) {
      let studentCodes = this.parson.normalizeIndents(codeLines);
      // Check opening and closing blocks.
      // The blockOpen and blockClose are expected to be maps with regexps as properties and
      // names of blocks as the property values. For example, a pseudocode IF..THEN..ELSE..ENDIF
      // blocks can be defined like this:
      //    open = {'^\s*IF.*THEN\s*$': 'IF', '^\s*ELSE\s*$':'IF'};
      //    close = {'^s*ELSE\s*$': 'IF', '^\s*ENDIF\s*$': 'IF'};
      let open = this.parson.options.blockOpen,
          close = this.parson.options.blockClose,
          blockErrors = [],
          errors = [];
      let progLang = this.parson.options.programmingLang;
      let langBlocks = LanguageTranslationGrader._languageBlocks;
      if (progLang && langBlocks[progLang]) {
        open = $.extend({}, open, langBlocks[progLang].open);
        close = $.extend({}, close, langBlocks[progLang].close);
      }

      if (open && close) { // check blocks only if block definitions are given
        let blocks = [],
            prevIndent = 0, // keep track of previous indent inside blocks
            minIndent = 0; // minimum indent needed inside newly opened blocks

        let noMatchingIds = [];
        let noMatchingOpenIds = [];
        let noMatchingCloseIds = [];
        let blockCloseMismatchIds = [];

        // go through all student code lines
        for (let idx = 0; idx < studentCodes.length; idx++) {
          let isClose = false, // was a new blocks opened on this line
              isOpen = false,  // was a block closed on this line
              item = studentCodes[idx],
              line = item.code, // code of the line
              idx1Based = idx + 1,
              topBlock, bO;

          // Check if a proper indentation or the line was found in normalizeIndents
          // -1 will mean no matching indent was found
          if (item.indent < 0) {
            // blockErrors.push(this.parson.translations.no_matching(idx1Based));
            noMatchingIds.push(item.id)
            break; // break on error
          }

          // Go through all block closing regexps and test if they match
          // Some lines can both close and open a block (such as else), so the
          // closing blocks need to be handled first
          for (let blockClose in close) {
            if (new RegExp(blockClose).test(line)) {
              isClose = true;
              topBlock = blocks.pop();
              if (!topBlock) {
                // blockErrors.push(this.parson.translations.no_matching_open(idx1Based, close[blockClose]));
                noMatchingOpenIds.push(item.id);
              } else if (close[blockClose] !== topBlock.name) { // incorrect closing block
                // blockErrors.push(this.parson.translations.blockClose_mismatch(idx1Based, close[blockClose], topBlock.line, topBlock.name));
                blockCloseMismatchIds.push(item.id);
              } else if (item.indent !== topBlock.indent) { // incorrect indent
                // blockErrors.push(this.parson.translations.no_matching(idx1Based));
                noMatchingIds.push(item.id)
              }
              prevIndent = topBlock ? topBlock.indent : 0;
              minIndent = 0;
              break; // only one block can be closed on a single line
            }
          }

          // Go through all block opening regexps and test if they match
          for (let blockOpen in open) {
            if (new RegExp(blockOpen).test(line)) {
              isOpen = true;
              bO = {
                name: open[blockOpen],
                indent: item.indent,
                line: idx1Based,
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
            if ((prevIndent && item.indent !== prevIndent) ||
                item.indent <= minIndent) {
              noMatchingIds.push(item.id);
            }
            prevIndent = item.indent;
          }
          // if we have errors, clear the blocks and exit from the loop
          if (blockErrors.length > 0) {
            blocks = [];
            break;
          }
        }

        // create errors for all blocks opened but not closed
        for (let block of blocks) {
          // blockErrors.push(this.parson.translations.no_matching_close(block.line, block.name));
          noMatchingCloseIds.push(item.id);
        }

        if (noMatchingIds) {
          errors.push(formatLogMsg(LOG_MSG.NO_MATCHING, {
            segmentIds: noMatchingIds
          }))
        }
        if (noMatchingOpenIds) {
          errors.push(formatLogMsg(LOG_MSG.NO_MATCHING_OPEN, {
            segmentIds: noMatchingOpenIds
          }))
        }
        if (noMatchingCloseIds) {
          errors.push(formatLogMsg(LOG_MSG.NO_MATCHING_CLOSE, {
            segmentIds: noMatchingCloseIds
          }))
        }
        if (blockCloseMismatchIds) {
          errors.push(formatLogMsg(LOG_MSG.blockClose_MISMATCH, {
            segmentIds: blockCloseMismatchIds
          }))
        }
      }

      // if there were errors in the blocks, give feedback and don't execute the code
      if (errors) {
        return {success: false, errors: errors}
      }

      // Replace codelines show with codelines to be executed
      // Get real executable codes with indent
      codeLines = this._replaceCodelines(studentCodes);
      // run unit tests or variable check grader
      if (this.parson.options.unittests) {
        return new UnitTestGrader(this.parson).grade(codeLines);
      } else {
        return new VariableCheckGrader(this.parson).grade(codeLines);
      }
    };

  }


  const GRADERS = {
    LineBasedGrader: LineBasedGrader,
    VariableCheckGrader: VariableCheckGrader,
    UnitTestGrader: UnitTestGrader,
    TurtleGrader: TurtleGrader,
    LanguageTranslationGrader: LanguageTranslationGrader,
  }

  // Create a line object skeleton with only code and indentation from
  // a code string of an assignment definition string (see parseCode)
  class ParsonsCodeline {
    static trimRegexp = /^\s*(.*?)\s*$/;
    static distractorRegex = /#distractor\s*$/;
    constructor (codestring, widget) {
      this.widget = widget;
      this.rawCode = '';
      this.indent = 0;
      this.numToggle = 0;
      this.toggleVals = [];
      this.toggleIdxs = [];
      this.isDistractor = false;

      // the original index of the line in the assignment definition string,
      // this is their expected position in solution
      this.origIdx = -1;

      if (codestring) {
        // Consecutive lines to be dragged as a single block of code have strings '\\n' to
        // represent newlines => replace them with actual new line characters '\n'
        codestring = stripHtml(codestring);
        this.rawCode = codestring.replace(ParsonsCodeline.distractorRegex, '').replace(ParsonsCodeline.trimRegexp, '$1').replace(/\\n/g, '\n');
        this.indent = codestring.length - codestring.replace(/^\s+/, '').length;

        if (codestring.match(ParsonsCodeline.distractorRegex)) {
          this.isDistractor = true;
          this.indent = -1;
        }

        let toggles = this.rawCode.match(this.widget.toggleRegexp);
        if (toggles) {
          this.numToggle = toggles.length;
          for (let item of toggles) {
            let opts = item.substring(10, item.length - 2).split(widget.options.toggleSeparator);
            this.toggleVals.push(opts);
          }
        }
      }
    }

    // get code with toggle values
    get code() {
      let code = this.rawCode;
      if (this.numToggle) {
        let toggles = code.match(this.widget.toggleRegexp);
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

    clone() {
      let newCl = new ParsonsCodeline();
      Object.assign(newCl, this);
      return newCl;
    }
  };

  // expose the type for testing, extending etc
  window.ParsonsCodeline = ParsonsCodeline;


  // Creates a parsons widget. Init must be called after creating an object.
  class ParsonsWidget {
    static GRADERS = GRADERS;

    constructor (options) {
      // Contains line objects of the user-draggable code.
      // The order is not meaningful (unchanged from the initial state) but
      // indent property for each line object is updated as the user moves
      // codelines around. (see parseCode for line object description)
      this.modifiedLines = [];

      // contains line objects of distractors (see parseCode for line object description)
      this.extraLines = [];

      // contains line objects (see parseCode for line object description)
      this.modelSolution = [];

      // (optional) executable codes
      this.executableLines = [];

      let defaults = {
        'xIndent': 50,
        'canIndent': true,
        'firstErrorOnly': true,
        'maxWrongLines': 10,
        'lang': 'en',
        'toggleSeparator': '::'
      };

      this.options = $.extend({}, defaults, options);
      this.idPrefix = options['sortableId'] + 'codeline';
      this.toggleRegexp = new RegExp('\\$\\$toggle(' + this.options.toggleSeparator + '.*?)?\\$\\$', 'g');

      if (this.options.hasOwnProperty('executableCode')) {
        let initialStruc = this.parseCode(this.options.executableCode.split('\n'), 0);
        this.executableLines = initialStruc.solution;
      }

      // use grader passed as an option if defined and is a function
      if (this.options.grader && _.isFunction(this.options.grader)) {
        this.grader = new this.options.grader(this);
      } else {
        // initialize the grader
        if (typeof this.options.unittests !== 'undefined') { /// unittests are specified
          this.grader = new UnitTestGrader(this);
        } else if (typeof this.options.vartests !== 'undefined') { /// tests for variable values
          this.grader = new VariableCheckGrader(this);
        } else { // 'traditional' parson feedback
          this.grader = new LineBasedGrader(this);
        }
      }
    };

    // Parses an assignment definition given as a string and returns and
    // transforms this into an object defining the assignment with line objects.
    //
    // lines: A string that defines the solution to the assignment and also
    //   any possible distractors
    // max_distractrors: The number of distractors allowed to be included with
    //   the lines required in the solution
    parseCode (lines, maxDistractors) {
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
      for (let idx=0; idx<lines.length; idx++) {
        let item = lines[idx];
        lineObject = new ParsonsCodeline(item, that);
        lineObject.origIdx = idx;
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
      };

      let normalized = this.normalizeIndents(indented);
      let noMatchingIds = [];
      for (let item of normalized) {
        if (item.indent < 0) {
          // Indentation error
          noMatchingIds.push(item.id);
        }
        widgetData.push(item);
      };

      if (noMatchingIds) {
        errors.push(formatLogMsg(LOG_MSG.NO_MATCHING, {
          segmentIds: noMatchingIds
        }));
      }

      // Add ids to all codeline objects
      let idPrefix = this.idPrefix;
      let codelines = [...widgetData, ...distractors];
      for (let idx = 0; idx < codelines.length; idx++) {
        codelines[idx].id = idPrefix + idx;
        codelines[idx].idx = idx;
      };

      // Remove extra distractors if there are more alternative distrators
      // than should be shown at a time
      //  let permutation = this.getRandomPermutation(distractors.length);
      let selectedDistractors = _.sample(distractors, maxDistractors);
      for (let item of selectedDistractors) {
        widgetData.push(item);
      }

      let widgetInitial = deepExtend([], widgetData);
      for (let item of widgetInitial) {
        item.indent = 0;
      }

      return {
        // an array of line objects specifying  the solution
        solution: deepExtend([], normalized),

        // an array of line objects specifying the requested number
        // of distractors (not all possible alternatives)
        distractors: deepExtend([], selectedDistractors),

        // an array of line objects specifying the initial code arrangement
        // given to the user to use in constructing the solution
        widgetInitial: widgetInitial,

        // Indentation
        // TODO detect errors in solution
        errors: errors
      };
    }

    init(text) {
      let initialStruc = this.parseCode(text.split('\n'), this.options.maxWrongLines);
      this.modelSolution = initialStruc.solution;
      this.extraLines = initialStruc.distractors;
      this.modifiedLines = initialStruc.widgetInitial;

      // Error handling
      return initialStruc.errors
    };

    // Get a line object by the full id including id prefix
    // (see parseCode for description of line objects)
    getLineById(id, targetGroup=null) {
      let index = -1;
      if (!targetGroup) {
        targetGroup = this.modifiedLines;
      }
      for (let i = 0; i < targetGroup.length; i++) {
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
    normalizeIndents(lines) {
      let normalized = [];
      let newLine;
      let matchIndent = function(index) {
        //return line index from the previous lines with matching indentation
        for (let i = index-1; i >= 0; i--) {
          if (lines[i].indent == lines[index].indent) {
            return normalized[i].indent;
          }
        }
        return -1;
      };
      for ( let i = 0; i < lines.length; i++ ) {
        newLine = lines[i].clone();
        if (i === 0) {
          newLine.indent = 0;
          if (lines[i].indent !== 0) {
            newLine.indent = -1;
          }
        } else if (lines[i].indent == lines[i-1].indent) {
          newLine.indent = normalized[i-1].indent;
        } else if (lines[i].indent > lines[i-1].indent) {
          newLine.indent = normalized[i-1].indent + 1;
        } else {
          // indentation can be -1 if no matching indentation exists, i.e. IndentationError in Python
          newLine.indent = matchIndent(i);
        }
        normalized[i] = newLine;
      }
      return normalized;
    };

    getFeedback(data) {
      let codeLines = [];
      // update indent
      for (let clData of data){
        let id = this.idPrefix + clData.idx;
        let cl = this.getLineById(id);
        if (!cl) continue;
        cl = cl.clone();
        cl.indent = clData.indent;
        cl.toggleIdxs = clData.toggleIdxs;
        codeLines.push(cl);
      }

      return this.grader.grade(codeLines);
     };

  };

  window['ParsonsWidget'] = ParsonsWidget;


  class ParsonsJS {
    constructor(config) {
      this.parson = new ParsonsWidget(config);
      this.codeStr = config.codeStr;
      this.order = config.order;
      this.logs = [];
    }

    init() {
      let errors = this.parson.init(this.codeStr);
      return errors;
    }

    initUI() {
      this.init();
      if (this.order) {
        this.initListItemFromOrder(this.order);
      } else {
        this.shuffleLines();
      }

      // Log the original codelines in the exercise in order to be able to
      // match the input/output hashes to the code later on. We need only a
      // few properties of the codeline objects
      this._addLog('init', this._getData());
    }

    codeLineAddToggles = function(codeLine) {
      let toggleRegexp = this.parson.toggleRegexp;
      let toggleSeparator = this.parson.options.toggleSeparator;
      let toggles = codeLine.rawCode.match(toggleRegexp);
      let html = codeLine.rawCode;

      if (toggles) {
        for (let toggle of toggles) {
          let opts = toggle.substring(10, toggle.length - 2).split(toggleSeparator);
          html = html.replace(
            toggle,
            "<span class='pjs-toggle' data-jsp-options='"
            + JSON.stringify(opts).replace('<', '&lt;')
            + "'></span>"
          );
        }
      }
      return html
    }

    codeLineToHTML(codeline) {
      let code = this.codeLineAddToggles(codeline);
      return '<li id="' + codeline.id + '" data-id="' + codeline.idx + '">' + code + '<\/li>';
    };

    codeLinesToHTML(codelineIDs, destinationID) {
      let lineHTML = [];
      for(let id in codelineIDs) {
        let line = this.parson.getLineById(codelineIDs[id]);
        lineHTML.push(this.codeLineToHTML(line));
      }
      return '<ul id="ul-' + destinationID + '">' + lineHTML.join('') + '</ul>';
    };

    getIndentNew($item, leftPosDiff) {
      let parson = this.parson;
      let indentCurr = $item.prop('data-indent');
      let indentNew = parson.options.canIndent ? indentCurr + Math.floor(leftPosDiff / parson.options.xIndent) : 0;
      indentNew = Math.max(0, indentNew);
      return indentNew;
    };

    updateHTMLIndent($item, indNew) {
      $item.css('margin-left', this.parson.options.xIndent * indNew + 'px');
      $item.prop('data-indent', indNew);
    };

    setToggleVal($codeline, toggleIdxs) {
      $codeline.find('.pjs-toggle').each(function(idx) {
        let $toggle = $(this),
            tIdx = toggleIdxs[idx],
            choices = $toggle.data('jsp-options');

        if (tIdx < 0 || !choices || tIdx > choices.length) {
          return
        }
        let newVal = choices[tIdx];
        $toggle.text(newVal);
        $toggle.prop('data-idx', tIdx);
      })
    }

    initSortableBox = function($box) {
      $box.find('li').each(function(_) {
        $(this).prop('data-indent', 0);
      })

      // init toggles
      let $toggles = $box.find('.pjs-toggle');
      $toggles.prop('data-idx', -1);
      $toggles.click(function () {
        let $toggle = $(this),
            curVal = $toggle.text(),
            choices = $toggle.data('jsp-options'),
            newIdx = (choices.indexOf(curVal) + 1) % choices.length,
            newVal = choices[newIdx];

        // change the shown toggle element
        $toggle.text(newVal);
        $toggle.prop('data-idx', newIdx);
      })
    }

    createHTMLFromLists(solutionIDs, trashIDs) {
      let parson = this.parson;
      let options = parson.options;
      let html;
      let $targetBox = $('#' + options.sortableId);

      if (options.trashId) {
        html = this.codeLinesToHTML(trashIDs, options.trashId);
        let $trashBox = $('#' + options.trashId);
        $trashBox.html(html);
        this.initSortableBox($trashBox);

        html = this.codeLinesToHTML(solutionIDs, options.sortableId);
        $targetBox.html(html);
      } else {
        html = this.codeLinesToHTML(solutionIDs, options.sortableId);
        $targetBox.html(html);
      }
      this.initSortableBox($targetBox);

      let that = this;
      let $sortable = $('#ul-' + options.sortableId).sortable({
          start : function() {},
          stop : function(event, ui) {
            if ($(event.target)[0] != ui.item.parent()[0]) {
              return;
            }
            let $item = ui.item;
            let posDiff = ui.position.left - ui.item.parent().position().left;
            let indNew = that.getIndentNew($item, posDiff);
            that.updateHTMLIndent($item, indNew);
          },
          receive : function(event, ui) {
            let $item = ui.item;
            let posDiff = ui.position.left - ui.item.parent().position().left;
            let indNew = that.getIndentNew($item, posDiff);
            that.updateHTMLIndent($item, indNew);
          },
          grid : parson.options.canIndent ? [parson.options.xIndent, 1 ] : false
      });
      $sortable.addClass('pjs-sortable');

      if (options.trashId) {
        let $trash = $('#ul-' + options.trashId).sortable({
          start: function() {
          },
          receive: function(event, ui) {
            that.updateHTMLIndent(ui.item, 0);
          },
          stop: function(event, ui) {
            if ($(event.target)[0] != ui.item.parent()[0]) {
              // line moved to output and logged there
              return;
            }
          }
        });
        $trash.sortable('option', 'connectWith', $sortable);
        $sortable.sortable('option', 'connectWith', $trash);
        $trash.addClass('pjs-sortable');
      }
    };

    getRandomPermutation = function(n) {
      return _.shuffle(_.range(n));
    };

    shuffleLines(idlist=null) {
      let parson = this.parson;
      // let permutation = (parson.options.permutation ? parson.options.permutation : this.getRandomPermutation)(parson.modifiedLines.length);
      if (!idlist) {
        let permutation = this.getRandomPermutation(parson.modifiedLines.length);
        idlist = [];
        for(let idx of permutation) {
          idlist.push(parson.modifiedLines[idx].id);
        }
      }

      if (parson.options.trashId) {
        this.createHTMLFromLists([], idlist);
      } else {
        this.createHTMLFromLists(idlist, []);
      }
    }

    initListItemFromOrder(order) {
      let idPrefix = this.parson.idPrefix;
      for (let item of order) {
        item.id = idPrefix + item.idx;
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

    _getData = function () {
      // get codeLineIds from DOM
      let codeLineIds = $('#ul-' + this.parson.options.sortableId).sortable('toArray');

      // get order + indent
      let data = [];
      for (let idx = 0; idx < codeLineIds.length; idx++) {
        let clId = codeLineIds[idx];
        let $cl = $('#' + clId);
        let toggleIdxs = [];
        $cl.find('.pjs-toggle').each(function () {
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

      return data;
    }

    _addLog = function (oper, data) {
      this.logs.push({
        oper: oper,
        data: data,
        time: new Date(),
      })
    }

    getFeedback = function() {
      let data = this._getData();
      let fb = this.parson.getFeedback(data);
      this._addLog('feedback', data);
      return fb;
    };

  }

  window['ParsonsJS'] = ParsonsJS;

// allows _ and $ to be modified with noconflict without changing the globals
// that parsons uses
})($,_);
