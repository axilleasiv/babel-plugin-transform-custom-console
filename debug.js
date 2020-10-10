const babel = require('babel-core');
const plugin = require('./lib/index');
const inspect = require('util').inspect;
const filename = 'file';
const plugins = [
  [
    plugin.logger,
    {
      consoleName: '$console',
      doc: {
        rel: filename,
        line: 0,
        idx: 1
      }
    }
  ]
];

const config = {
  plugins,
  filename,
  retainLines: false,
  comments: true
};

const $console = {
  log: function() {
    var args = Array.prototype.slice.call(arguments);
    var line = args.pop();
    console.log({ type: 'console', line: line, values: inspect(args) });
  }
};

const { code } = babel.transform(
  `
    var locations = [
    {
      id: 1,
      name: 'Paris',
      country: 'France',
      population: 2140526
    },
    {
      id: 7,
      name: 'Athens',
      country: 'Greece',
      population: 3090508
    },
    {
      id: 9,
      name: 'Los Angeles',
      country: 'United States',
      population: 3999759
    }
  ];

  var getCountry = country => 'The country is: ' + country;

  var result = locations
    .filter(location => {
      return location.population >= 2200000 && location.population <= 4000000
    })
    .map(location => {
      return getCountry(location.country);
    })
`,
  config
);

console.log(`${code}\n`);
eval(code);
