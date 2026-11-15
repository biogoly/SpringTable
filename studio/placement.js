(() => {
  'use strict';

  function makePlan(rings, diameter, margin) {
    if (!Array.isArray(rings) || rings.length === 0) throw new RangeError('A layout needs at least one ring.');
    if (!Number.isFinite(diameter) || diameter <= 0) throw new RangeError('Enter a positive ring diameter.');
    if (!Number.isFinite(margin) || margin < 0) throw new RangeError('Enter a nonnegative edge margin.');

    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    let nearestSquared = Infinity;
    for (let i = 0; i < rings.length; i++) {
      const {x, y} = rings[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Ring coordinates must be finite.');
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      for (let j = 0; j < i; j++) {
        const dx = x - rings[j].x, dy = y - rings[j].y;
        nearestSquared = Math.min(nearestSquared, dx * dx + dy * dy);
      }
    }

    // Studio and the front of the board both use positive Y down.
    const inset = diameter / 2 + margin;
    const points = rings.map(({x, y}, index) => ({
      id: index + 1,
      x: (x - left) + inset,
      y: (y - top) + inset
    }));
    return {
      width: (right - left) + 2 * inset,
      height: (bottom - top) + 2 * inset,
      diameter,
      margin,
      points,
      minDistance: points.length > 1 ? Math.sqrt(nearestSquared) : null
    };
  }

  const mm = value => value.toFixed(3);

  function csv(plan) {
    const rows = plan.points.map(({id, x, y}) => [id, mm(x), mm(y)].join(','));
    return ['ring,x_from_left_mm,y_from_top_mm', ...rows, ''].join('\r\n');
  }

  function svg(plan) {
    const width = mm(plan.width), height = mm(plan.height);
    const radius = plan.diameter / 2;
    const tick = mm(Math.min(3, radius * 0.2));
    const labelSize = mm(Math.min(5, radius * 0.38));
    const labelY = mm(radius * 0.65);
    const marks = plan.points.map(({id, x, y}) => (
      `  <g id="ring-${id}" transform="translate(${mm(x)} ${mm(y)})">
    <circle r="${mm(radius)}" fill="none" stroke="#424242" stroke-width="0.25"/>
    <path d="M -${tick} 0 H ${tick} M 0 -${tick} V ${tick}" fill="none" stroke="#111" stroke-width="0.25"/>
    <text x="0" y="${labelY}" font-family="sans-serif" font-size="${labelSize}" text-anchor="middle">${id}</text>
  </g>`
    ));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">
  <title>SpringTable ring placement</title>
  <desc>Front view in millimeters. Measure from the top-left corner, X to the right and Y down. Crosshairs mark ring centers. Circles show ring outer diameters.</desc>
  <rect x="0" y="0" width="${width}" height="${height}" fill="none" stroke="#111" stroke-width="0.4"/>
${marks.join('\n')}
</svg>\n`;
  }

  window.SpringPlacement = {makePlan, csv, svg};
})();
