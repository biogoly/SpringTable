const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

global.window = {};
require('../studio/placement.js');
const { makePlan, csv, svg } = window.SpringPlacement;
const projectSource = fs.readFileSync(path.join(__dirname, '../studio/project.js'), 'utf8');
const {geometry, validateProject} = vm.runInNewContext(projectSource + '\n({geometry, validateProject})');

test('board bounds use the outer edges and a margin on all four sides', () => {
  const rings = [{x: -80.125, y: 0.125}, {x: -77.125, y: -3.875}, {x: -68.125, y: -7.875}];
  const plan = makePlan(rings, 37.5, 2.25);
  assert.equal(plan.width, 54);
  assert.equal(plan.height, 50);
  assert.equal(plan.minDistance, 5);
  assert.deepEqual(plan.points, [
    {id: 1, x: 21, y: 29}, {id: 2, x: 24, y: 25}, {id: 3, x: 33, y: 21}
  ]);

  const translated = rings.map(p => ({x: p.x + 240, y: p.y - 892}));
  assert.deepEqual(makePlan(translated, 37.5, 2.25), plan);
});

test('single and coincident rings retain their IDs and minimum-distance semantics', () => {
  const p = {x: -40, y: 8};
  const single = makePlan([p], 38, 0);
  assert.deepEqual(single, {
    width: 38, height: 38, diameter: 38, margin: 0,
    minDistance: null, points: [{id: 1, x: 19, y: 19}]
  });
  const coincident = makePlan([p, p], 38, 10);
  assert.equal(coincident.minDistance, 0);
  assert.deepEqual(coincident.points, [{id: 1, x: 29, y: 29}, {id: 2, x: 29, y: 29}]);
});

test('200-ring Studio spiral exports the same numbered mounting centers in CSV and SVG', () => {
  const rings = geometry('spiral', 1, 1, 200, 60);
  const plan = makePlan(rings, 38, 10);
  const rows = csv(plan).trimEnd().split('\r\n');
  const drawing = svg(plan);
  assert.equal(rows.shift(), 'ring,x_from_left_mm,y_from_top_mm');
  assert.equal(rows.length, 200);
  assert.equal(rows[0], '1,528.972,519.937');
  assert.equal(rows[199], '200,1035.549,555.760');
  assert.ok(Math.abs(plan.width - 1064.54895319853) < 1e-8);
  assert.ok(Math.abs(plan.height - 1054.14825892825) < 1e-8);
  assert.ok(Math.abs(plan.minDistance - 36) < 1e-9);
  assert.match(drawing, /width="1064\.549mm" height="1054\.148mm" viewBox="0 0 1064\.549 1054\.148"/);

  const centers = [...drawing.matchAll(/id="ring-(\d+)" transform="translate\(([\d.]+) ([\d.]+)\)"/g)];
  assert.equal(centers.length, 200);
  for (let index = 0; index < rows.length; index++) {
    const columns = rows[index].split(',');
    const point = plan.points[index];
    assert.equal(point.id, index + 1);
    assert.deepEqual(centers[index].slice(1), columns);
    assert.ok(Math.abs(Number(columns[1]) - point.x) <= 0.0005);
    assert.ok(Math.abs(Number(columns[2]) - point.y) <= 0.0005);
    assert.ok(Math.abs((point.y - plan.points[0].y) - (rings[index].y - rings[0].y)) < 1e-9);
    assert.ok(Math.abs((point.x - plan.points[0].x) - (rings[index].x - rings[0].x)) < 1e-9);
  }
  assert.equal([...drawing.matchAll(/<circle r="19\.000"/g)].length, 200);
  assert.equal([...drawing.matchAll(/<path d=/g)].length, 200);
  assert.deepEqual([...drawing.matchAll(/text-anchor="middle">(\d+)<\/text>/g)].map(m => Number(m[1])),
    Array.from({length: 200}, (_, index) => index + 1));
});

test('the published example opens with its dimensions and reproduces both placement files', () => {
  const sample = path.join(__dirname, '../examples/200-ring-spiral/200-ring-spiral');
  const read = extension => fs.readFileSync(sample + extension, 'utf8').replace(/\r\n/g, '\n');
  const saved = JSON.parse(read('.json'));
  const project = validateProject(saved);
  const plan = makePlan(project.rings, project.placement.diameter, project.placement.margin);
  assert.equal(plan.points.length, 200);
  assert.ok(Math.abs(plan.minDistance - plan.diameter - 10) < 1e-9);
  assert.equal(csv(plan).replace(/\r\n/g, '\n'), read('.csv'));
  assert.equal(svg(plan), read('.svg'));
  assert.throws(() => validateProject({...saved, placement:{diameter:38, margin:-1}}));
  delete saved.placement;
  assert.equal(validateProject(saved).placement, undefined);
});
