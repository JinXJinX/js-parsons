// var assertCodeEquals = function(lines1, lines2) {
//   assert.equal(lines1.length, lines2.length);
// };

// codelines in array2 may have extra features
var assertCodesEqual = function(assert, code1, code2, message) {
  assert.equal(code1.length, code2.length);
  for (var i=0; i<code1.length; i++) {
    let item1 = code1[i];
    let item2 = code2[i];
    assert.equal(item1.code, item2.code, message + ' code of line ' + i );
    assert.equal(item1.indent, item2.indent, message + ' indentation of line ' + i);
    // if (typeof item1.distractor !== 'undefined' && typeof item2.distractor !== 'undefined') {
    //   assert.equal(code1[i].distractor, code2[i].distractor, message + ' distractor of line ' + i);
    // }
  }
};

QUnit.module('Utilities', function() {
  QUnit.test("getRandomPermutation()", function(assert) {
    var initial = [
      [0, 'foo'],
      [1, 'bar']
    ];
    var parson = new ParsonsWidget({
      'codeLines': initial,
      'sortableId': 'main'
    });
    var perm = parson.getRandomPermutation(2);
    assert.equal(perm.length,2);
    assert.ok( (perm[0] == 0 && perm[1] == 1) || (perm[0] == 1 && perm[1] == 0) );
  });

  QUnit.test("normalizeIndents()", function(assert) {
    var codeLine = function(elem, index) { return {'indent': elem}; };
    var initial = [
      [0, 'foo'],
      [1, 'bar']
    ];
    var parson = new ParsonsWidget({
      'codeLines': initial, 'sortableId': 'main'
    });
    var perm = parson.getRandomPermutation(2);
    assert.deepEqual(
      parson.normalizeIndents(jQuery.map([0, 1, 2, 1], codeLine)),
      jQuery.map([0, 1, 2, 1], codeLine),
      "already normalized"
    );

    assert.deepEqual(
      parson.normalizeIndents(jQuery.map([0, 1, 2, 2, 1, 2, 0], codeLine)),
      jQuery.map([0, 1, 2, 2, 1, 2, 0], codeLine),
      "already normalized"
    );

    assert.deepEqual(
      parson.normalizeIndents(jQuery.map([0, 4, 5, 4], codeLine)),
      jQuery.map([0, 1, 2, 1], codeLine),
      "too much indented"
    );

    assert.deepEqual(
      parson.normalizeIndents(jQuery.map([0, 4, 5, 3], codeLine)),
      jQuery.map([0, 1, 2, -1], codeLine),
      "no matching indentation"
    );

    assert.deepEqual(
      parson.normalizeIndents(jQuery.map([1, 1], codeLine))[0],
      codeLine(-1,0),
      "first item should not be indented"
    );
  });
})

QUnit.module('Initialization of the widget', function() {
  QUnit.test("internal data structures", function(assert) {
    var initial =
      'def traverse_in_order(binary_node):\n' +
      '  if binary_node:\n' +
      '  if not binary_node: #distractor\n' +
      '    foo\n' +
      '  foo-1\n';
    var parson = new ParsonsWidget({'sortableId': 'main'});
    parson.init(initial);
    // parson.shuffleLines();

    assertCodesEqual(
      assert, parson.model_solution, [
        {'code': 'def traverse_in_order(binary_node):', 'indent':0},
        {'code': 'if binary_node:', 'indent':1},
        {'code': 'foo', 'indent':2},
        {'code': 'foo-1', 'indent':1}
      ], 'model solution'
    );

    assertCodesEqual(
      assert, parson.extra_lines, [
        {'code': 'if not binary_node:', 'indent': -1},
      ], 'distractors'
    );

    //distractors are moved to the end
    assertCodesEqual(
      assert, parson.modified_lines, [
        {'code': 'def traverse_in_order(binary_node):', 'indent':0},
        {'code': 'if binary_node:', 'indent':0},
        {'code': 'foo', 'indent':0},
        {'code': 'foo-1', 'indent':0},
        {'code': 'if not binary_node:', 'indent':0},
      ]
    );
  });

  QUnit.test("items in the sortable list (no distractors)", function(assert) {
    var initial =
      'def hello(name):\n' +
      '  print name\n';
    var parson = new ParsonsWidget({'sortableId': 'main'});
    parson.init(initial);
    parson.shuffleLines();

    var optionTexts = [];
    $("#main ul li").each(function() {optionTexts.push($(this).text()) });

    assert.deepEqual(
      optionTexts.sort(),
      ['def hello(name):', 'print name'],
      'li elements should contain the codelines'
    );
  });

  QUnit.test("items in the sortable list (distractors)", function(assert) {
    var initial =
    'def hello(name):\n' +
    '  print name\n' +
    '  xxx #distractor\n';

    var parson = new ParsonsWidget({'sortableId': 'main', 'max_wrong_lines': 1});
    parson.init(initial);
    parson.shuffleLines();

    var optionTexts = [];
    $("#main ul li").each(function() { optionTexts.push($(this).text()) });
    assert.deepEqual(
      optionTexts.sort(),
      ['def hello(name):', 'print name', 'xxx'],
      'li elements should contain the codelines'
    );
  });
})

QUnit.module('Feedback', function() {
  QUnit.test("Everything ok", function(assert) {
    var initial = 'foo\nbar\n';
    var parson = new ParsonsWidget({
      'sortableId': 'main',
      'max_wrong_lines': 1,
      permutation: function(n) {return [0, 1];}
    });
    parson.init(initial);
    parson.shuffleLines();

    assert.equal(parson.getFeedback().length, 0);
  });

  QUnit.test("Wrong order", function(assert) {
    var initial = 'foo\nbar\n';
    var parson = new ParsonsWidget({
      'sortableId': 'main',
      'max_wrong_lines': 1,
      permutation: function(n) {return [1, 0];}
    });
    parson.init(initial);
    parson.shuffleLines();

    assert.ok(parson.getFeedback().length > 0, 'there should be some feedback');
  });
})

QUnit.module('Lis', function() {
  QUnit.test("Best lise inverse", function(assert) {
    assert.deepEqual(LIS.best_lise_inverse([1, 4, 6, 2, 3, 5]), [4, 6]);
    assert.deepEqual(LIS.best_lise_inverse([4, 5, 6, 1, 2, 3]), [4, 5, 6]);
    assert.deepEqual(LIS.best_lise_inverse([3, 2, 1]), [3, 2]);
    assert.deepEqual(LIS.best_lise_inverse([4, 5, 1, 3, 6]), [1, 3]);
  });
})
