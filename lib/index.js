'use strict';

var t = require('@babel/types');
var parser = require('@babel/parser');
var traverse = require('@babel/traverse');

exports.__esModule = true;

function getConsoleStatement(node, name, line) {
  var statement = t.expressionStatement(
    t.callExpression(
      t.memberExpression(t.identifier(name), t.identifier('log')),
      [node, t.numericLiteral(line || node.loc.end.line)]
    )
  );

  return statement;
}

function getCallExpression(origNode, name, path, log) {
  var identifier = path.scope.generateUidIdentifier('func');
  var line = origNode.loc.end.line;
  var type = origNode.type;
  var expression, propertyExpression, node;

  if (type === 'ExpressionStatement') {
    node = origNode.expression;
  } else if (type === 'ReturnStatement') {
    node = origNode.argument;
  } else if (type === 'VariableDeclaration') {
    node = origNode.declarations[0].init;
  }

  //TODO: test for callExpressions
  if (log && log.type === 'log') {
    if (log.inExpression) {
      propertyExpression = t.memberExpression(
        identifier,
        t.identifier(log.property)
      );
    } else {
      propertyExpression = parser.parse(log.property);
      traverse.default.removeProperties(propertyExpression);
      propertyExpression = propertyExpression.program.body[0].expression;
    }
  }

  expression = t.callExpression(
    t.functionExpression(
      null,
      [],
      t.blockStatement([
        t.variableDeclaration('var', [t.variableDeclarator(identifier, node)]),
        getConsoleStatement(
          propertyExpression ? propertyExpression : identifier,
          name,
          line
        ),
        t.returnStatement(identifier)
      ])
    ),
    []
  );

  if (type === 'ReturnStatement') {
    expression = t.returnStatement(expression);
  } else if (type === 'VariableDeclaration') {
    origNode.declarations[0].init = expression;
    return origNode;
  }

  expression.loc = node.loc;

  return expression;
}

function isExpression(comment) {
  return comment.charAt(0) === '=';
}

function hasLogExpression(node) {
  return (
    node.trailingComments &&
    node.trailingComments.length &&
    isExpression(node.trailingComments[0].value)
  );
}

function getExpression(comment) {
  comment = comment.replace(/\s/g, '').slice(1);

  if (comment !== '') {
    if (comment.indexOf('$.') !== -1) {
      var property = comment.split('$.')[1];

      return {
        type: 'log',
        property: property,
        inExpression: true
      };
    }

    return {
      type: 'log',
      property: comment
    };
  }

  return {
    type: 'result'
  };
}

function checkComments(node) {
  if (hasLogExpression(node)) {
    var comment = node.trailingComments[0].value;
    var expression = getExpression(comment);

    node.trailingComments.shift();

    return expression;
  }

  return false;
}

function logThroughComments(node, path, state) {
  var log = checkComments(node);

  if (log) {
    path.replaceWith(
      getCallExpression(node, state.opts.consoleName, path, log)
    );

    return true;
  }

  return false;
}

function isConsoleLog(callee) {
  if (
    callee.object &&
    callee.object.name === 'console' &&
    callee.property &&
    callee.property.name === 'log'
  ) {
    return true;
  }

  return false;
}

function isReplFile(state) {
  return state.filename === state.opts.fileName;
}

exports.default = function() {
  return {
    visitor: {
      VariableDeclaration: function VariableDeclaration(path, state) {
        var node = path.node;

        if (!isReplFile(state) || !node.loc) {
          return;
        }

        if (node.declarations.length === 1) {
          logThroughComments(node, path, state);
        }
      },

      CallExpression: function CallExpression(path, state) {
        var node = path.node;

        if (!isReplFile(state) || !node.loc) {
          return;
        }

        if (isConsoleLog(node.callee)) {
          node.arguments.push(t.numericLiteral(node.loc.end.line));
          node.callee.object.name = state.opts.consoleName;

          return;
        }

        logThroughComments(node, path, state);
        logThroughComments(path.parent, path, state);
      },

      ReturnStatement: function ReturnStatement(path, state) {
        if (!isReplFile(state)) {
          return;
        }
        var node = path.node;

        logThroughComments(node, path, state);
      },

      MemberExpression: function MemberExpression(path, state) {
        if (!isReplFile(state)) {
          return;
        }
        var node = path.node;

        logThroughComments(node, path, state);
        if (logThroughComments(path.parent, path, state)) {
          path.skip();
        }
      },

      JSXExpressionContainer: function JSXExpressionContainer(path) {
        if (!isReplFile(state)) {
          return;
        }
        path.skip();
      },

      Identifier: function Identifier(path, state) {
        var node = path.node;
        var allowed = ['expression', 'object'];
        if (!isReplFile(state) || !node.loc) {
          return;
        }

        if (allowed.indexOf(path.parentKey) === -1) {
          return;
        }

        if (logThroughComments(node, path, state)) {
          return;
        }

        if (path.parentKey === 'expression') {
          path.replaceWith(getConsoleStatement(node, state.opts.consoleName));
          path.skip();
        }
      },

      BinaryExpression: function BinaryExpression(path, state) {
        if (!isReplFile(state)) {
          return;
        }

        var node = path.node;
        if (path.parentKey === 'expression') {
          path.replaceWith(getConsoleStatement(node, state.opts.consoleName));
        }
      }
    },

    inherits: function() {
      return {
        manipulateOptions: function manipulateOptions(opts, parserOpts) {
          parserOpts.plugins.push('customConsole');
        }
      };
    }
  };
};

module.exports = exports['default'];
