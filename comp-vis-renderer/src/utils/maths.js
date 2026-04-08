// Some utility functions for math operations.

import * as d3 from "d3";

export function getEvenlySpacedValues(minValue, maxValue, num) {
  if (num <= 0) return [];
  if (num === 1) return [minValue];

  num = Math.min(num, 10); // Temporary workaround; ideally refline count should match tick count

  const step = (maxValue - minValue) / (num - 1);

  const result = [];
  for (let i = 0; i < num; i++) {
    result.push(minValue + i * step);
  }

  result[num - 1] = maxValue;

  return result;
}

export function mySum(arr) {
  return arr.reduce((acc, val) => acc + val, 0);
}

/**
 * For a line chart, if all y values are >= 0, remove points where y == 0.
 *
 * @param {*} data
 */
export function filterMissingValue(data) {
  const allPositive = data.every((d) => d.y >= 0);
  if (allPositive) {
    return data.filter((d) => d.y !== 0);
  }
  return data;
}

export function checkAllInteger(data, keyName) {
  // First check whether all values are numbers.
  const allNumbers = data.every((d) => typeof d[keyName] === "number");

  // If so, check whether all of them are integers.
  if (allNumbers) {
    return data.every((d) => Number.isInteger(d[keyName]));
  }

  return false;
}

// For a UNION node (root), get min/max over Y across all children.
export function getYMinMaxValues(root) {
  const yValues = root.children.map((child) => child.Y.data);
  let yMax = Math.max(...yValues.flat(2));
  let yMin = Math.min(...yValues.flat(2));
  if (yMin > 0) {
    yMin = 0;
  }
  return [yMin, yMax];
}

// For a UNION node (root), get min/max over X across all children.
export function getXMinMaxValues(root) {
  const xValues = root.children.map((child) => child.X.data);
  let xMax = Math.max(...xValues.flat(2));
  let xMin = Math.min(...xValues.flat(2));
  // X does not need to start from 0.
  return [xMin, xMax];
}

export function getValueField(node) {
  if (
    Array.isArray(node.Y.data[0]) &&
    node.Y.data[0].every((d) => typeof d === "number")
  ) {
    return d3.sum(node.Y.data[0]);
  }
  return 1; // default value
}

export function getXyMinMax(data, xMin, xMax, yMin, yMax) {
  let xMinVal = xMin || xMin === 0 ? xMin : d3.min(data, (d) => d.x);
  let xMaxVal = xMax || xMax === 0 ? xMax : d3.max(data, (d) => d.x);
  let yMinVal = yMin || yMin === 0 ? yMin : d3.min(data, (d) => d.y);
  let yMaxVal = yMax || yMax === 0 ? yMax : d3.max(data, (d) => d.y);
  return [xMinVal, xMaxVal, yMinVal, yMaxVal];
}

/**
 * Enhance a tick value array by inserting new ticks within a given range and
 * ensuring the range endpoints are included.
 *
 * @export
 * @param {number[]} tickValues - A sorted float array with a consistent step.
 * @param {number} minVal - Minimum value of the range.
 * @param {number} maxVal - Maximum value of the range.
 * @param {number} [minStep=30] - Minimum allowed step between newly inserted ticks.
 * @returns {number[]} - A new enhanced and sorted tick value array.
 */
export function enhanceTickValues(
  tickValues,
  minVal,
  maxVal,
  minStep = 25,
  minDist = 3,
) {
  // Avoid numeric precision issues.
  // Round tickValues/minVal/maxVal to a fixed number of decimals.
  tickValues = tickValues.map((d) => Number(d.toFixed(4)));
  minVal = Number(minVal.toFixed(4));
  maxVal = Number(maxVal.toFixed(4));

  // --- 1) Handle edge cases ---
  if (!tickValues || tickValues.length === 0) {
    const result = new Set([minVal, maxVal]);
    if (maxVal - minVal > minStep) {
      // If there is enough space, add some intermediate values.
      let current = minVal + minStep;
      while (current < maxVal) {
        result.add(current);
        current += minStep;
      }
    }
    return Array.from(result).sort((a, b) => a - b);
  }

  if (tickValues.length === 1) {
    const val = tickValues[0];
    if (maxVal - val <= val - minVal) {
      // Closer to maxVal.
      return enhanceTickValues([val, maxVal], minVal, maxVal, minStep, minDist);
    } else {
      return enhanceTickValues([minVal, val], minVal, maxVal, minStep, minDist);
    }
  }

  // --- 2) Compute a finer step ---
  tickValues = tickValues.sort((a, b) => a - b);
  const originalStep = tickValues[1] - tickValues[0];

  // Determine how many subdivisions to split the original step into while
  // keeping each sub-step >= minStep.
  // If originalStep <= minStep, do not subdivide (subdivisions = 1).
  const subdivisions =
    originalStep > minStep ? Math.floor(originalStep / minStep) : 1;

  // Compute the new finer step.
  const newStep = originalStep / subdivisions;

  // If the computed step is 0, bail out with endpoints.
  if (newStep === 0) {
    return [minVal, maxVal];
  }

  // --- 3) Generate the new tick array ---
  // Use a Set to automatically handle duplicates.
  const enhancedTicks = new Set([minVal, maxVal]);

  // To avoid floating-point accumulation errors, generate ticks from a reference
  // point using multiplication. Use tickValues[0] as the reference.
  const refPoint = tickValues[0];

  // Generate ticks forward until exceeding maxVal.
  let currentTick = refPoint;
  while (currentTick <= maxVal) {
    // Only add values within [minVal, maxVal].
    if (currentTick >= minVal) {
      enhancedTicks.add(currentTick);
    }
    currentTick += newStep;
  }

  // Generate ticks backward until exceeding minVal.
  currentTick = refPoint - newStep; // Start from the previous tick
  while (currentTick >= minVal) {
    if (currentTick <= maxVal) {
      enhancedTicks.add(currentTick);
    }
    currentTick -= newStep;
  }

  let ticks = Array.from(enhancedTicks).sort((a, b) => a - b);

  // Post-process: avoid awkward results when there are too few ticks.
  if (ticks.length === 2) {
    // Only minVal and maxVal exist; sample two evenly spaced points between them.
    const _step = (maxVal - minVal) / 3;
    ticks = [minVal, minVal + _step, minVal + 2 * _step, maxVal];
  } else if (ticks.length === 3) {
    return enhanceTickValues(tickValues, minVal, maxVal, minStep / 2, minDist);
  }

  // Post-process: prune ticks that are too close to each other.
  if (ticks.length >= 4) {
    if (ticks[1] - ticks[0] < minDist) {
      ticks.splice(0, 1);
    }
    const n = ticks.length;
    if (ticks[n - 1] - ticks[n - 2] < minDist) {
      ticks.splice(n - 1, 1);
    }
  }

  return ticks;
}

export function columnAggregate(data) {
  if (data.length === 0) return null;
  const colCount = data[0].length;
  const result = [];
  for (let c = 0; c < colCount; c++) {
    const colSum = data.reduce((sum, row) => sum + row[c], 0);
    result.push(colSum);
  }
  return result;
}
