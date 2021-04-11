const babel = require('@babel/core');
const { trace: plugin } = require('../lib/index');
const filename = 'file';
const idx = 1;
const plugins = [
  [
    plugin,
    {
      consoleName: '$console',
      doc: {
        rel: filename,
        line: 0,
        idx,
      }
    }
  ]
];

const config = {
  plugins,
  filename,
  comments: false
};

const $console = {
  log: jest.fn(function() {
    var args = Array.prototype.slice.call(arguments);

    console.log('------------------------->>>> ', args);

    return args;
  }),
  trace: jest.fn(function() {
    var args = Array.prototype.slice.call(arguments);

    return args;
  }),
};

beforeEach(() => {
  $console.log.mockClear();
  $console.trace.mockClear();
});


it.only('trace', () => {
  const { code } = babel.transform(
    `
function funcA(argA1, argA2) {
  return funcB();
}

function funcB(argB1, argB2) {
  return funcC();
}

function funcC(argC1, argC2) {
  return 'Result ====>> C Function Called';
}

function main() {
  return funcA();
}

const result = main();
console.log(result);
    `,
    config
  );

  console.log('------------------------->>>> ', code)

  eval(code);

  expect($console.trace).toHaveBeenCalledTimes(13);
});

/* function funcA(argA1, argA2) {
  return funcB();
}

function funcB(argB1, argB2) {
  return funcC();
}

function funcC(argC1, argC2) {
  return 'C Function Called';
}

function funcD(argC1, argC2) {
  console.log(1);

  return 1;
}

function main() {
  return funcA();
}

const result = main();


funcA();
funcB();
funcC(); */