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

function consoleThroughComments(node) {
  if (
    node.trailingComments &&
    node.trailingComments.length === 1 &&
    node.trailingComments[0].value === '='
  ) {
    node.trailingComments = null;
    return true;
  }

  return false;
}

exports.default = function () {
  return {
    visitor: {
      ExpressionStatement: function ExpressionStatement(path, state) {
        var node = path.node;
        if (state.file.opts.basename !== state.opts.fileName || !node.loc) {
          return;
        }

        if (consoleThroughComments(node)) {
          node.trailingComments = null;
          path.insertAfter(getConsoleStatement(node.expression, state.opts.consoleName));
        }
      },

      CallExpression: function CallExpression(path, state) {
        var node = path.node;

        if (state.file.opts.basename !== state.opts.fileName || !node.loc) {
          return;
        }

        if (consoleThroughComments(node)) {
          node.trailingComments = null;
          path.getStatementParent().insertAfter(getConsoleStatement(node, state.opts.consoleName));
        }

      },

      Identifier: function Identifier(path, state) {
        var node = path.node;
        if (state.file.opts.basename !== state.opts.fileName || !node.loc) {
          return;
        }

        if (consoleThroughComments(node)) {
          node.trailingComments = null;
          path.getStatementParent().insertAfter(getConsoleStatement(node, state.opts.consoleName));
        } else if (path.parentKey === 'expression') {
          path.replaceWith(getConsoleStatement(node, state.opts.consoleName));
        }
      },

      MemberExpression: function MemberExpression(path, state) {
        if (state.file.opts.basename !== state.opts.fileName) {
          return;
        }
        var node = path.node;
        if (node.object && node.object.name === 'console' && node.property && node.property.name === 'log') {
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
      }
    },

    inherits: function () {
      return {
        manipulateOptions: function manipulateOptions(opts, parserOpts) {
          parserOpts.plugins.push("customConsole");
        }
      };
    }
  };
};

module.exports = exports["default"];