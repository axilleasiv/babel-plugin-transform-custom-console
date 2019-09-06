'use strict';

var t = require('@babel/types');
var parser = require('@babel/parser');
var traverse = require('@babel/traverse');
var Path = require('path');
var allowedIdentifiers = ['expression', 'object'];

function getConsoleStatement(node, name, line, rel, propName, type) {
  type = type || 'log';
  propName = propName || node.name;

  var statement = t.expressionStatement(
    t.callExpression(
      t.memberExpression(t.identifier(name), t.identifier(type)),
      [
        node,
        t.numericLiteral(line || node.loc.end.line),
        t.stringLiteral(rel),
        propName && t.stringLiteral(propName)
      ]
    )
  );

  return statement;
}

function getCallExpression(origNode, name, path, log, rel) {
  var identifier = path.scope.generateUidIdentifier('val');
  var line = origNode.loc.end.line;
  var type = origNode.type;
  var expression, propertyExpression, node;

  if (type === 'ExpressionStatement') {
    node = origNode.expression;
  } else if (type === 'ReturnStatement') {
    node = origNode.argument;
  } else if (type === 'VariableDeclaration') {
    node = origNode.declarations[0].init;
  } else {
    node = origNode;
  }

  // TODO: test for callExpressions
  if (log && log.type === 'log') {
    if (log.inExpression) {
      propertyExpression = t.memberExpression(
        identifier,
        t.identifier(log.property)
      );
    } else {
      try {
        propertyExpression = parser.parse(log.property);
        traverse.default.removeProperties(propertyExpression);
        if (propertyExpression.program.body.length) {
          propertyExpression = propertyExpression.program.body[0].expression;
        } else {
          propertyExpression = undefined;
        }
      } catch (err) {
        // TODO: err
        propertyExpression = undefined;
      }
    }
  }

  expression = t.callExpression(
    t.functionExpression(
      null,
      [],
      t.blockStatement([
        t.variableDeclaration('var', [t.variableDeclarator(identifier, node)]),
        getConsoleStatement(propertyExpression || identifier, name, line, rel),
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

  expression.loc = origNode.loc;

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

  if (comment !== '' && comment.length > 2) {
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

function getIdentifier(key) {
  // if (parseInt(key) !== NaN) {
  //   return t.numericLiteral(parseInt(key));
  // }

  return t.identifier(key);
}

function createMemberExpression(dotted) {
  dotted = dotted.split('.');
  var memberExpression = t.memberExpression(
    t.identifier(dotted[0]),
    t.identifier(dotted[1]),
    !Number.isNaN(parseInt(dotted[1]))
  );
  var arr = dotted.slice(2);

  while (arr.length) {
    var property = arr.shift();
    memberExpression = t.memberExpression(
      memberExpression,
      t.identifier(property),
      !Number.isNaN(parseInt(property))
    );
  }

  return memberExpression;
}

function getPropName(prop) {
  return prop.name || '[' + prop.value + ']';
}

function getNameFromExpression(expression) {
  var properties = [getPropName(expression.property)];
  var object = expression.object;

  while (object.type === 'MemberExpression') {
    properties.unshift(getPropName(object.property));
    object = object.object;
  }

  properties.unshift(object.name);
  properties = properties.join('.');
  return properties.replace(/\.[[]/g, '[');

  // return properties.join('.');
}

function checkComments(node) {
  if (hasLogExpression(node)) {
    var comment = node.trailingComments[0].value;
    var expression = getExpression(comment);

    node.trailingComments = [];

    return expression;
  }

  return false;
}

function logThroughComments(node, path, state) {
  var log = checkComments(node);

  if (log) {
    path.replaceWith(
      getCallExpression(node, state.opts.consoleName, path, log, state.opts.rel)
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

function checkEvaluation(opts, path, name, line, rel) {
  const expressions = [];

  opts.toVal
    .filter(function(val) {
      return (
        val.name.indexOf(name) === 0 && val.line === line && val.rel === rel
      );
    })
    .forEach(function(item) {
      var name = item.name;
      expressions.push(
        getConsoleStatement(
          createMemberExpression(name),
          opts.consoleName,
          line,
          rel,
          'evaluation:' + name,
          'val'
        )
      );
    });

  if (expressions.length) {
    path.replaceWithMultiple(expressions);
  }

  opts.toVal = opts.toVal.filter(function(val) {
    return !(
      val.name.indexOf(name) === 0 &&
      val.line === line &&
      val.rel === rel
    );
  });

  if (opts.toVal.length === 0) {
    opts.toVal = null;
  }
}

module.exports = function() {
  return {
    name: 'console',
    visitor: {
      VariableDeclaration: function VariableDeclaration(path, state) {
        var node = path.node;

        if (node.declarations.length === 1) {
          logThroughComments(node, path, state);
        }
      },

      CallExpression: function CallExpression(path, state) {
        var node = path.node;

        if (node.arguments.length && isConsoleLog(node.callee)) {
          var line = node.loc.end.line;
          var rel = state.opts.rel;
          var name;
          if (node.arguments[0].type === 'MemberExpression') {
            name = getNameFromExpression(node.arguments[0]);
          } else {
            name = node.arguments[0].name || '';
          }

          if (state.opts.toVal) {
            checkEvaluation(state.opts, path, name, line, rel);
            return;
          } else {
            node.arguments.push(
              t.numericLiteral(line),
              t.stringLiteral(rel),
              t.stringLiteral(name)
            );

            node.callee.object.name = state.opts.consoleName;
          }

          return;
        }

        logThroughComments(node, path, state);
        logThroughComments(path.parent, path, state);
      },

      ReturnStatement: function ReturnStatement(path, state) {
        var node = path.node;

        logThroughComments(node, path, state);
      },
      // TODO: what we need this? will we support arr.length
      // or other member expressions without comments
      MemberExpression: function MemberExpression(path, state) {
        var node = path.node;

        logThroughComments(node, path, state);
        if (logThroughComments(path.parent, path, state)) {
          path.skip();
        }
      },

      Identifier: function Identifier(path, state) {
        var node = path.node;

        // TODO: node.name = cov_jbjx08c0d;

        if (allowedIdentifiers.indexOf(path.parentKey) === -1) {
          return;
        }

        if (
          logThroughComments(node, path, state) ||
          logThroughComments(path.parent, path, state)
        ) {
          return;
        }

        if (path.parentKey === 'expression') {
          var rel = state.opts.rel;
          var line = node.loc.end.line;
          var name = node.name;
          if (state.opts.toVal) {
            checkEvaluation(state.opts, path, name, line, rel);
          } else {
            path.replaceWith(
              getConsoleStatement(node, state.opts.consoleName, line, rel, name)
            );
          }

          path.skip();
        }
      },

      BinaryExpression: function BinaryExpression(path, state) {
        var node = path.node;

        if (path.parentKey === 'expression') {
          path.replaceWith(
            getConsoleStatement(
              node,
              state.opts.consoleName,
              undefined,
              state.opts.rel
            )
          );
        }
      }
    }
  };
};
