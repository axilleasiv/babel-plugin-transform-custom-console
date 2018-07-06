"use strict";

exports.__esModule = true;

var Position = function Position(line, column) {
  this.line = line;
  this.column = column;
}

var SourceLocation = function SourceLocation(start, end) {
  this.start = start;
  this.end = end;
};

var loc = new SourceLocation(
  new Position(0, 0),
  new Position(0, 0)
)

var consoleName = '$console';

function Node(start, end, loc, type, filename) {
  this.type = type ? type : '';
  this.start = start;
  this.end = end;
  this.loc = loc;
  if (filename) this.loc.filename = filename;
}

function consoleNode(node) {
  var newNode = new Node(node.start, node.end, node.loc, 'CallExpression');
  newNode.arguments = [];
  newNode.callee = new Node(node.start, node.end, node.loc, 'MemberExpression');
  newNode.callee.computed = false;
  newNode.callee.object = new Node(node.start, node.end, node.loc, 'Identifier');
  newNode.callee.object.name = consoleName;
  newNode.callee.property = new Node(node.start, node.end, node.loc, 'Identifier');
  newNode.callee.property.name = 'log';
  newNode.arguments.push(node.__clone());

  var lineNode = new Node(
    newNode.start,
    newNode.end,
    newNode.loc,
    'NumericLiteral'
  );

  lineNode.value = newNode.loc.end.line;
  newNode.arguments.push(lineNode);

  return newNode;
}

var skipExpressions = [
  'CallExpression',
  'MemberExpression',
  'ObjectExpression',
  'FunctionExpression',
  'AssignmentExpression',
  'ThisExpression',
  'NewExpression',
  'BinaryExpression',
  'StringLiteral',
  // 'NumericLiteral' //check this
];

exports.default = function () {
  return {
    visitor: {
      MemberExpression: function MemberExpression(path, state) {
        if (state.file.opts.basename !== 'mainReplAsset') {
          return;
        }

        var node = path.node;
        if (node.object && node.object.name === 'console' && node.property && node.property.name === 'log') {
          var newNode = new Node(node.start, node.end, node.loc, 'NumericLiteral');

          newNode.value = node.loc.end.line;

          path.parent.arguments.push(newNode);
          node.object.name = consoleName;
        }
      },

      BinaryExpression: function BinaryExpression(path, state) {
        if (state.file.opts.basename !== 'mainReplAsset') {
          return;
        }

        var node = path.node;
        if (path.parentKey === 'expression') {
          path._replaceWith(consoleNode(node));
        }
      },

      Expression: function Expression(path, state) {
        if (state.file.opts.basename !== 'mainReplAsset') {
          return;
        }

        var node = path.node;
        if (skipExpressions.indexOf(node.type) !== -1) {
          return;
        }

        if (path.parentKey === 'expression') {
          path._replaceWith(consoleNode(node));
        }
      }
    }
  };
};

module.exports = exports["default"];