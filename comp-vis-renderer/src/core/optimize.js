// This file aims to optimize width & height & radius & angle, in order to meet all the constraints.

// adjust size for horizontal stacking, meeting all the chart constraints
// w: Array of width for all children
// h: Array of height for all children
// constraints: Array of constraints for all children
// hasSibling: Array of boolean values indicating if the child has a sibling
// returns: Array of adjusted width and height
export function optimizeHStack(w, h, constraints, hasSibling) {
  const n = w.length;

  // check that all arrays are valid
  if (n === 0 || h.length !== n || constraints.length !== n) {
    throw new Error("All arrays must have the same length!");
  }

  // the problem is to find the optimal w&h for each children, such that:
  // 1. w[i] >= minWidth[i]
  // 2. h[i] >= minHeight[i]
  // 3. minAspectRatio[i] <= w[i] / h[i] <= maxAspectRatio[i]
  // 4. w[i] and h[i] as small as possible

  // step1: Set H = h[i] = max(minHeight[i])
  // in HStack case, each child shares the same height (H)
  let H = Math.max(...constraints.map((constraint) => constraint.minHeight));

  // step2
  for (let i = 0; i < n; i++) {
    H = Math.max(H, constraints[i].minWidth / constraints[i].maxAspectRatio);
    if (hasSibling[i]) {
      H = Math.max(H, h[i]);
    }
  }

  // step3
  for (let i = 0; i < n; i++) {
    const oldW = w[i];
    h[i] = H;
    w[i] = Math.max(H * constraints[i].minAspectRatio, constraints[i].minWidth);
    if (hasSibling[i]) {
      w[i] = Math.max(w[i], oldW);
    }
  }

  // // step4: if area too large, set w[i] = minWidth[i]
  // for (let i = 0; i < n; i++) {
  //   if (h[i] * w[i] > constraints[i].maxArea) {
  //     w[i] = constraints[i].minWidth;
  //   }
  // }
}

// adjust size for vertical stacking, meeting all the chart constraints
export function optimizeVStack(w, h, constraints, hasSibling) {
  const n = w.length;

  // check that all arrays are valid
  if (n === 0 || h.length !== n || constraints.length !== n) {
    throw new Error("All arrays must have the same length!");
  }

  // step1: Set W = w[i] = max(minWidth[i])
  // in VStack case, each child shares the same width (W)
  let W = Math.max(...constraints.map((constraint) => constraint.minWidth));

  // step2
  for (let i = 0; i < n; i++) {
    W = Math.max(W, constraints[i].minHeight * constraints[i].minAspectRatio);
    if (hasSibling[i]) {
      W = Math.max(W, w[i]);
    }
  }

  // step3
  for (let i = 0; i < n; i++) {
    const oldH = h[i];
    w[i] = W;
    h[i] = Math.max(
      W / constraints[i].maxAspectRatio,
      constraints[i].minHeight,
    );
    if (hasSibling[i]) {
      h[i] = Math.max(h[i], oldH);
    }
  }

  // // step4: if area too large, set h[i] = minHeight[i]
  // for (let i = 0; i < n; i++) {
  //   if (h[i] * w[i] > constraints[i].maxArea) {
  //     h[i] = constraints[i].minHeight;
  //   }
  // }
}

// adjust size for circular stacking, meeting all the chart constraints
// parameters: r1(innerRadius), r2(outerRadius), a1(startAngle), a2(endAngle)
// parameters (cont.): constraints(minRadius, minArclen), hasSibling(true/false), marginAngle
// polar constraints include:
// 1. r2[i] - r1[i] >= minRadius[i]
// 2. r1[i] * (a2[i] - a1[i]) >= minArclen[i]
export function optimizeCStack(
  r1,
  r2,
  a1,
  a2,
  constraints,
  hasSibling,
  marginAngle,
) {
  // step1: get sum_i(a2[i] - a1[i]) == 2 * PI - n * marginAngle
  const n = r1.length;
  const totAngle = 2 * Math.PI - n * marginAngle;

  // step2: set r = r1[0] = ... = r1[n-1] = sum(minArclen[i]) / totAngle
  const sumArclen = constraints.reduce(
    (sum, constraint) => sum + constraint.minArclen,
    0,
  );
  let r = sumArclen / totAngle;

  // step3: if some node has sibling, then we don't want to further compress the space for its inner siblings
  for (let i = 0; i < n; i++) {
    if (hasSibling[i]) {
      r = Math.max(r, r1[i]);
    }
  }

  // step3: set shared radius
  const radius = Math.max(
    ...constraints.map((constraint) => constraint.minRadius),
  );

  // step4: set all parameters
  // angle range is proportional to `minArclen`
  let currentStartAngle = 0;
  for (let i = 0; i < n; i++) {
    r1[i] = r;
    r2[i] = r + radius;
    a1[i] = currentStartAngle;
    a2[i] =
      currentStartAngle + (constraints[i].minArclen * totAngle) / sumArclen;
    currentStartAngle = a2[i] + marginAngle;
  }
}

export function optimizeRStack(r1, r2, a1, a2, constraints, margin) {
  console.log(r1, r2, a1, a2, constraints, margin);
  // step1: determine a1 = a1[0] = ... = a1[n-1], a2 = a2[0] = ... = a2[n-1]
  const n = r1.length;
  let startAngle = -Number.MAX_VALUE;
  let endAngle = Number.MAX_VALUE;
  for (let i = 0; i < n; i++) {
    startAngle = Math.max(startAngle, a1[i]);
    endAngle = Math.min(endAngle, a2[i]);
  }

  // step2: set all parameters
  let currentInnerRadius = r1[0];
  for (let i = 0; i < n; i++) {
    a1[i] = startAngle;
    a2[i] = endAngle;
    r1[i] = currentInnerRadius;
    r2[i] = r1[i] + constraints[i].minRadius;
    if (i < n - 1) {
      r2[i] = Math.max(
        r2[i],
        constraints[i + 1].minArclen / (a2[i] - a1[i]) - margin,
      );
    }
    currentInnerRadius = r2[i] + margin;
  }
}
