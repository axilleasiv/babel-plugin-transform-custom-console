const babel = require('@babel/core');
const { logger: plugin } = require('../lib/index');
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

const detectInfiniteLoops = 100;
const $console = {
  log: jest.fn(function() {
    var args = Array.prototype.slice.call(arguments);

    return args;
  }),
  loops: {},
  detectLoop: jest.fn(function(location, filename, idx) {
    const key = `${location[0]}-${location[1]}-${filename}-${idx}`;

    if (!this.loops[key]) {
      this.loops[key] = 0;
    }

    if (this.loops[key] >= detectInfiniteLoops) {
      this.loops[key] = undefined;
      throw new Error(`Too many loops detected (×${detectInfiniteLoops})`);
    }
    this.loops[key] += 1;
  }),
};

beforeEach(() => {
  $console.log.mockClear();
});

it('simple one line console', () => {
  const { code } = babel.transform(`console.log(1)`, config);
  expect(code).toMatchSnapshot();
});

it('simple console message', () => {
  const { code } = babel.transform(`console.log('message')`, config);
  expect(code).toMatchSnapshot();
});

it('console message with arguments', () => {
  const { code } = babel.transform(
    `console.log('Array', [1, 2, 3], 'Object', '{a:1, b:2}')`,
    config
  );

  expect(code).toMatchSnapshot();
});

it('CommentLine log on var', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200, 5, 5555] //=`,
    config
  );
  expect(code).toMatchSnapshot();
});

it('CommentBlock log on var', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200, 5, 5555] /*=*/`,
    config
  );
  expect(code).toMatchSnapshot();

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(
    [[1000, 200, 5, 5555]],
    [[1, 1]],
    'file',
    ['arr~_val'],
    idx
  );
});

it('CommentLine log expression', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200, 5, 5555] //= $.length`,
    config
  );
  expect(code).toMatchSnapshot();

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(
    [4],
    [[1, 1]],
    'file',
    ['arr.length~_val'],
    idx
  );
});

it('BinaryExpression', () => {
  const { code } = babel.transform(`1000 + 1000`, config);

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith([2000], [[1, 1]], 'file', ['+'], 1);
});

it('Identifier expression', () => {
  const { code } = babel.transform(`var arr = [1000, 200];\n arr`, config);

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(
    [[1000, 200]],
    [[2, 2]],
    'file',
    ['arr'],
    idx
  );
});

it('Identifier through comments', () => {
  const { code } = babel.transform(`var arr = [1000, 200];\n arr //=`, config);

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(
    [[1000, 200]],
    [[2, 2], [1, 1]],
    'file',
    ['arr~_val'],
    idx
  );
});

it('Identifier through comments property', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200];\n arr //= $.length`,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(
    [2],
    [[2, 2], [1, 1]],
    'file',
    ['arr.length~_val'],
    idx
  );
});

it('VariableDeclaration through comments', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200]; //=
    var arr2 = [1000, 200]; //= $.length`,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(2);
  expect($console.log).toBeCalledWith(
    [[1000, 200]],
    [[1, 1]],
    'file',
    ['arr~_val'],
    idx
  );
  expect($console.log).toBeCalledWith(
    [2],
    [[2, 2]],
    'file',
    ['arr2.length~_val2'],
    idx
  );
});

it('MemberExpression through comments', () => {
  const { code } = babel.transform(
    `var arr = [1000, 200];
    arr.length; //=`,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(1);
  expect($console.log).toBeCalledWith(
    [2],
    [[2, 2]],
    'file',
    ['arr.length~_val'],
    idx
  );
});

it('CallExpression', () => {
  const { code } = babel.transform(
    `
    var i = 0;
    function fn() {
      i++;
      return 'value';
    }
    fn(); //=
    console.log(i);
    `,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(2);
  expect($console.log).toBeCalledWith(
    ['value'],
    [[7, 7], [3, 6]],
    'file',
    ['fn()~_val'],
    idx
  );
  expect($console.log).toBeCalledWith([1], [[8, 8], [2, 2]], 'file', ['i'], 1);
});

it('CallExpression object', () => {
  const { code } = babel.transform(
    `
    var i = 0;
    var obj = {
      fn: function() {
        i++;
        return 'value';
      }
    }
    obj.fn(); //=
    console.log(i);
    `,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(2);
  expect($console.log).toBeCalledWith(
    ['value'],
    [[9, 9]],
    'file',
    ['obj.fn()~_val'],
    idx
  );
  expect($console.log).toBeCalledWith(
    [1],
    [[10, 10], [2, 2]],
    'file',
    ['i'],
    idx
  );
});

it('Check double comments or falsy chars', () => {
  const { code } = babel.transform(
    `
      var obj = {
        a: 5,
        b: 6,
        c: 7
      }

      obj; //= //=$.c
      obj.a; //= //=
      obj.b; /*=*/ /*=*/
      obj.c; //= (((((#$@(&*^@!)@!)@!#^$@!)))))
    `,
    config
  );

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(4);
  expect($console.log).toBeCalledWith(
    [7],
    [[8, 8], [2, 6]],
    'file',
    ['obj.c~_val'],
    idx
  );
  expect($console.log).toBeCalledWith(
    [5],
    [[9, 9]],
    'file',
    ['obj.a~_val2'],
    idx
  );
  expect($console.log).toBeCalledWith(
    [6],
    [[10, 10]],
    'file',
    ['obj.b~_val3'],
    idx
  );
  expect($console.log).toBeCalledWith(
    [7],
    [[11, 11]],
    'file',
    ['obj.c~_val4'],
    idx
  );
});

it('Expression through comments', () => {
  const { code } = babel.transform(
    `
      var i = 0;
      var arr = [1, 2, 3] //= i++;
      i //=
      i /*=*/
      i /*= i++ */
      i
      arr//= arr.length
      arr//= $.length
    `,
    config
  );

  expect(code).toMatchSnapshot();

  eval(code);

  expect($console.log).toHaveBeenCalledTimes(7);
  //i increased to 2
  expect($console.log).toBeCalledWith([2], [[7, 7]], 'file', ['i'], 1);
});

it('Chain CallExpression', () => {
  const { code } = babel.transform(
    `
      var arr = [1000, 200, 10, 1];

      arr //=
        .sort(function(a, b) {
          return a > b
        }) //=
        .filter(function(val) {
          return val > 5
        }) //=
        .reverse() //=
    `,
    config
  );

  eval(code);

  expect(code).toMatchSnapshot();
  expect($console.log).toHaveBeenCalledTimes(4);
  expect($console.log).toHaveBeenNthCalledWith(1,
    [[1000, 200, 10, 1]],
    [[4, 4]],
    filename,
    ["arr~_val4"],
    idx
  );
  expect($console.log).toHaveBeenNthCalledWith(2,
    [[1000, 200, 10, 1]],
    [[4, 7]],
    filename,
    ["arr .sort(function(a, b) {return a > b})~_val3"],
    idx,
  );
});

it('Object destructuring', () => {
  const { code } = babel.transform(
    `const profile = {
      firstName: 'John',
      lastName: 'Doe',
      age: 17,
      details: {
        city: 'Athens',
        country: 'Greece',
      },
    };

    const {
      firstName,
      lastName,
      age,
      details,
      details: { city, country: aliasCountry },
    } = profile;

    console.log(firstName, lastName, age, details, city, aliasCountry);`,
    config
  );

  eval(code);

  expect(code).toMatchSnapshot();
  expect($console.log).toHaveBeenCalledTimes(1);

  const details = {
    city: 'Athens',
    country: 'Greece'
  };

  expect($console.log).toBeCalledWith(
    ["John", "Doe", 17, details, details.city, details.country],
    [
      [[19, 19], [11, 17]],
      [[19, 19], [11, 17]],
      [[19, 19], [11, 17]],
      [[19, 19], [11, 17]],
      [[19, 19], [11, 17]],
      [[19, 19], [11, 17]],
    ],
    'file',
    ['firstName', 'lastName', 'age', 'details', 'city', 'aliasCountry'],
    idx,
  );
});

it('detectInfiniteLoop#disabled', () => {
  const { code } = babel.transformSync(
    `function powerRanger(power, min, max) {
      let powValue = 0;
      let counter = min;
      let listArr = [];
      while (powValue < max) {
        powValue = Math.pow(power, 1 / counter);

        break;

        listArr.push(counter);
        counter++;
      }
      return listArr;
    }
    console.log(powerRanger(2, 49, 65));`,
    config
  );

  eval(code);

  expect($console.detectLoop).toHaveBeenCalledTimes(0);
});

it('detectInfiniteLoop#enabled', () => {
  const plugins = [
    [
      plugin,
      {
        consoleName: '$console',
        detectInfiniteLoops: true,
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


  const { code } = babel.transformSync(
    `function powerRanger(power, min, max) {
      let powValue = 0;
      let counter = min;
      let listArr = [];
      while (powValue < max) {
        powValue = Math.pow(power, 1 / counter);

        break;

        listArr.push(counter);
        counter++;
      }
      return listArr;
    }
    console.log(powerRanger(2, 49, 65));`,
    config
  );

  eval(code);

  expect($console.detectLoop).toHaveBeenCalledTimes(1);
  expect($console.loops).toEqual({"5-12-file-1": 1});
});
