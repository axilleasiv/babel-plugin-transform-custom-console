//TODO 4 check the performance by using njstrace 
"use strict";

var t = require('babel-types');

exports.__esModule = true;

function getConsoleStatement(node, name, line) {
  line = line ? line : node.loc.end.line;


  return t.expressionStatement(
    t.callExpression(
      t.memberExpression(t.identifier(name), t.identifier('log')),
      [node, t.numericLiteral(line)]
    )
  );
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
      Program: function Program(path, state) {
        var comments = state.file.ast.comments;
        var line;

        if (!state.opts.consoleName) {
          state.opts.overrideConsole = false;
          state.opts.consoleName = 'console';
        }

        state.dynamicData.consoleFromComments = {};

        comments.forEach(function (comment) {
          line = comment.loc.start.line;

          if (comment.value === '=' && line === comment.loc.end.line) {
            state.dynamicData.consoleFromComments[line] = true;
            comment.ignore = true;
          }
        });
      },

      ExpressionStatement: function ExpressionStatement(path, state) {
        var node = path.node;
        if (state.file.opts.basename !== state.opts.fileName || !node.loc) {
          return;
        }

        if (node.trailingComments) {
          console.log('--> ExpressionStatement');
          node.trailingComments = null;
          path.insertAfter(getConsoleStatement(node.expression, state.opts.consoleName));
        }
      },

      CallExpression: function CallExpression(path, state) {
        var node = path.node;

        if (state.file.opts.basename !== state.opts.fileName || !node.loc) {
          return;
        }

        if (node.trailingComments) {
          console.log('--> CallExpression');
          node.trailingComments = null;
          path.getStatementParent().insertAfter(getConsoleStatement(node, state.opts.consoleName));
        }

      },

      Identifier: function Identifier(path, state) {
        var node = path.node;
        if (state.file.opts.basename !== state.opts.fileName || !node.loc) {
          return;
        }

        if (node.trailingComments) {
          console.log('--> Identifier');
          node.trailingComments = null;
          path.getStatementParent().insertAfter(getConsoleStatement(node, state.opts.consoleName));
        }
      },

      MemberExpression: function MemberExpression(path, state) {
        if (state.file.opts.basename !== state.opts.fileName) {
          return;
        }
        var node = path.node;
        if (state.opts.overrideConsole && node.object && node.object.name === 'console' && node.property && node.property.name === 'log') {
          path.parent.arguments.push(t.numericLiteral(node.loc.end.line));
          node.object.name = state.opts.consoleName;
        }
      },
      BinaryExpression: function BinaryExpression(path, state) {
        if (state.file.opts.basename !== state.opts.fileName) {
          return;
        }

        var node = path.node;
        if (path.parentKey === 'expression') {
          path.replaceWith(getConsoleStatement(node, state.opts.consoleName));
        }
      },
      Expression: function Expression(path, state) {
        if (state.file.opts.basename !== state.opts.fileName) {
          return;
        }

        var node = path.node;
        if (skipExpressions.indexOf(node.type) !== -1) {
          return;
        }

        if (path.parentKey === 'expression') {
          path.replaceWith(getConsoleStatement(node, state.opts.consoleName));
        }
      }
    },

    inherits: function () {
      return {
        manipulateOptions: function manipulateOptions(opts, parserOpts) {
          parserOpts.plugins.push("customRepl");
        }
      };
    }
  };
};

module.exports = exports["default"];