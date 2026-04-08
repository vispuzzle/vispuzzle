import * as d3 from "d3";
import { format } from "d3-format";
import { axisCartesian } from "./axis.js";
import { createSector } from "./elements.js";
import { globalSettings } from "../core/global.js";
import { getTextColor } from "../utils/vis.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getAnglePoint(angle, radius) {
  return {
    x: radius * Math.sin(angle),
    y: -radius * Math.cos(angle),
  };
}

function withAlpha(color, alpha) {
  const parsed = d3.color(color);
  if (!parsed) return color;
  parsed.opacity = alpha;
  return parsed.formatRgb();
}

function normalizeAngleDelta(delta) {
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

function getPointerAngle(event, anchor, svgNode) {
  const [x, y] = d3.pointer(event, svgNode);
  return Math.atan2(y - anchor.y, x - anchor.x);
}

function getCurrentPinAnchor(g, pinTipY, fallbackAnchor = null) {
  const node = g.node();
  const ctm = node?.getCTM?.();
  if (ctm) {
    return {
      x: ctm.c * pinTipY + ctm.e,
      y: ctm.d * pinTipY + ctm.f,
    };
  }
  return fallbackAnchor;
}

function getCoordinateRotationTargets(svgNode, label) {
  return d3
    .select(svgNode)
    .selectAll(
      ".chart-layer > g[data-label], .chart-layer > *[data-label][data-moved='true']",
    )
    .filter(function () {
      return d3.select(this).attr("data-label") === label;
    });
}

function ensureCoordinateBaseTransform(element) {
  if (element.attr("data-coordinate-base-transform") == null) {
    element.attr(
      "data-coordinate-base-transform",
      element.attr("transform") || "",
    );
  }
}

function parseTranslate(transform = "") {
  const match = transform.match(/translate\(\s*([-\d.]+)[,\s]+([-\d.]+)\s*\)/);
  if (!match) {
    return { x: 0, y: 0, match: null };
  }
  return {
    x: parseFloat(match[1]),
    y: parseFloat(match[2]),
    match: match[0],
  };
}

function replaceTranslate(transform = "", x, y) {
  const { match } = parseTranslate(transform);
  const translatePart = `translate(${x}, ${y})`;
  if (match) {
    return transform.replace(match, translatePart);
  }
  return transform ? `${translatePart} ${transform}` : translatePart;
}

function rotatePoint(point, anchor, angleDeg) {
  const angleRad = (angleDeg * Math.PI) / 180;
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: anchor.x + dx * cos - dy * sin,
    y: anchor.y + dx * sin + dy * cos,
  };
}

function getPinShadowOffsetX(angleDeg, maxDrift) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return Math.sin(angleRad) * maxDrift;
}

function applyCoordinatePinRotation(target, angleDeg, pinTipY) {
  const shadowLayer = target.select(".pin-shadow-layer");
  if (!shadowLayer.empty()) {
    const maxDrift = Number(shadowLayer.attr("data-shadow-drift-max") || 0);
    const shadowOffsetX = getPinShadowOffsetX(angleDeg, maxDrift);
    shadowLayer.attr("transform", `translate(${shadowOffsetX}, 0)`);
  }

  const shellLayer = target.select(".pin-shell-layer");
  if (!shellLayer.empty()) {
    shellLayer.attr("transform", `rotate(${angleDeg}, 0, ${pinTipY})`);
  }

  const contentLayer = target.select(".pin-content-layer");
  if (!contentLayer.empty()) {
    const contentScale = Number(
      contentLayer.attr("data-pin-content-scale") || 1,
    );
    const rotatedCenter = rotatePoint(
      { x: 0, y: 0 },
      { x: 0, y: pinTipY },
      angleDeg,
    );
    contentLayer.attr(
      "transform",
      `translate(${rotatedCenter.x}, ${rotatedCenter.y}) scale(${contentScale})`,
    );
    return rotatedCenter;
  }

  return { x: 0, y: 0 };
}

function applyCoordinateTargetTranslation(target, offset) {
  ensureCoordinateBaseTransform(target);
  const baseTransform = target.attr("data-coordinate-base-transform") || "";
  const baseTranslate = parseTranslate(baseTransform);
  target.attr(
    "transform",
    replaceTranslate(
      baseTransform,
      baseTranslate.x + offset.x,
      baseTranslate.y + offset.y,
    ),
  );
}

function enableCoordinatePinRotation(g, anchor, pinTipY) {
  const svgNode = g.node()?.ownerSVGElement;
  const label = g.attr("data-label");
  if (!svgNode || !label || !anchor) return;

  let dragState = null;
  g.attr("data-coordinate-rotation", "0")
    .classed("coordinate-pin-rotatable", true)
    .style("cursor", "grab")
    .style("touch-action", "none")
    .call(
      d3
        .drag()
        .on("start", function (event) {
          const liveAnchor = getCurrentPinAnchor(g, pinTipY, anchor);
          if (!liveAnchor) return;
          dragState = {
            anchor: liveAnchor,
            angle: getPointerAngle(event, liveAnchor, svgNode),
            rotation: Number(g.attr("data-coordinate-rotation") || 0),
          };
          g.style("cursor", "grabbing");
          getCoordinateRotationTargets(svgNode, label).each(function () {
            ensureCoordinateBaseTransform(d3.select(this));
          });
          event.sourceEvent?.stopPropagation?.();
        })
        .on("drag", function (event) {
          if (!dragState) return;
          const currentAngle = getPointerAngle(
            event,
            dragState.anchor,
            svgNode,
          );
          const delta = normalizeAngleDelta(currentAngle - dragState.angle);
          dragState.angle = currentAngle;
          dragState.rotation += (delta * 180) / Math.PI;

          const targets = getCoordinateRotationTargets(svgNode, label);
          const contentOffset = applyCoordinatePinRotation(
            g,
            dragState.rotation,
            pinTipY,
          );
          targets.each(function () {
            if (this === g.node()) return;
            applyCoordinateTargetTranslation(d3.select(this), contentOffset);
          });
          g.attr("data-coordinate-rotation", dragState.rotation);
        })
        .on("end", function () {
          dragState = null;
          g.style("cursor", "grab");
        }),
    );
}

/**
 * Creates a donut chart using D3.js.
 * When innerRadius is 0, the result is a pie chart.
 * When endAngle - startAngle is Math.PI, the result is a semicircle donut chart.
 *
 * Data format: [{ x: "A", y: 10 }, { x: "B", y: 20 }, ...]
 *
 * @param {Object[]} data
 * @param {Object} g
 * @param {number} startAngle
 * @param {number} endAngle
 * @param {number} innerRadius
 * @param {number} outerRadius
 * @param {Object} order
 * @param {function} color
 * @param {Object} [options={}]
 */
export function createDonutChart(
  data,
  g,
  startAngle,
  endAngle,
  innerRadius,
  outerRadius,
  order,
  color,
  options = {},
) {
  // parse additonal options
  const {
    style = "default",
    chartStyle = null,
    showValues = true,
    showNames = true,
    returns = null,
    minSegmentAngle = (2 * Math.PI) / 180,
    segmentBackgroundAlpha = 0.22,
    segmentGapAngle = (5 * Math.PI) / 180,
    endSegmentPaddingAngle = null,
    fullCircleEndPaddingAngle = null,
  } = options || {};

  const contentGroup =
    chartStyle === "pin" ? g.append("g").attr("class", "pin-content-layer") : g;
  if (chartStyle === "pin") {
    const pinContentScale = 1.0;
    contentGroup
      .attr("data-pin-content-scale", pinContentScale)
      .attr("transform", `scale(${pinContentScale})`);
  }

  const chartRenderMode =
    style === "equal-angle-progress" ? "equal-angle-progress" : "default";
  const sectorStyle = style === "sketch" ? "sketch" : "default";

  // console.log("pie data", data);
  if (Array.isArray(order)) {
    data = data.sort((a, b) => order.indexOf(a.x) - order.indexOf(b.x));
  }
  const colorScale = typeof color === "function" ? color : () => color;

  const useEqualAngleProgress =
    chartRenderMode === "equal-angle-progress" && innerRadius > 0;

  let pieData;
  if (useEqualAngleProgress) {
    const segmentCount = data.length;
    const totalAngle = endAngle - startAngle;
    const isFullCircle = Math.abs(totalAngle - 2 * Math.PI) < 1e-6;
    const resolvedTailPadding =
      endSegmentPaddingAngle == null
        ? fullCircleEndPaddingAngle
        : endSegmentPaddingAngle;
    const rawTailPadding =
      resolvedTailPadding == null
        ? Number(segmentGapAngle) || 0
        : Number(resolvedTailPadding) || 0;
    const tailPadding = isFullCircle
      ? clamp(rawTailPadding, 0, Math.max(0, totalAngle * 0.9))
      : 0;
    const effectiveTotalAngle = Math.max(0, totalAngle - tailPadding);
    const segmentAngle =
      segmentCount > 0 ? effectiveTotalAngle / segmentCount : 0;
    const maxValue =
      d3.max(data, (d) => {
        const value = Number(d.y);
        return Number.isFinite(value) ? Math.max(value, 0) : 0;
      }) || 0;
    const gapAngle = clamp(Number(segmentGapAngle) || 0, 0, segmentAngle * 0.9);
    const bgAlpha = clamp(Number(segmentBackgroundAlpha) || 0, 0, 1);

    pieData = data.map((item, index) => {
      const segmentStart = startAngle + index * segmentAngle;
      const segmentEnd = segmentStart + segmentAngle;
      const bgStart = segmentStart;
      const bgEnd = segmentEnd - gapAngle;
      const availableAngle = Math.max(0, bgEnd - bgStart);
      const minVisibleAngle = clamp(
        Number(minSegmentAngle) || 0,
        0,
        availableAngle,
      );
      const value = Number.isFinite(Number(item.y))
        ? Math.max(Number(item.y), 0)
        : 0;
      const progress = maxValue > 0 ? clamp(value / maxValue, 0, 1) : 0;
      const filledAngle =
        value > 0
          ? clamp(
              Math.max(availableAngle * progress, minVisibleAngle),
              0,
              availableAngle,
            )
          : 0;
      const progressEndAngle = bgStart + filledAngle;
      const progressMidAngle =
        filledAngle > 0 ? bgStart + filledAngle / 2 : (bgStart + bgEnd) / 2;

      return {
        data: item,
        value,
        startAngle: segmentStart,
        endAngle: segmentEnd,
        bgStartAngle: bgStart,
        bgEndAngle: bgEnd,
        filledAngle,
        progressEndAngle,
        progressMidAngle,
      };
    });

    pieData.forEach((d) => {
      const sectorGroup = contentGroup.append("g").attr("class", "arc");
      const baseColor = colorScale(d.data.x);
      createSector(
        sectorGroup,
        innerRadius,
        outerRadius,
        d.bgStartAngle,
        d.bgEndAngle,
        withAlpha(baseColor, bgAlpha),
        sectorStyle,
      );

      if (d.progressEndAngle > d.bgStartAngle) {
        createSector(
          sectorGroup,
          innerRadius,
          outerRadius,
          d.bgStartAngle,
          d.progressEndAngle,
          baseColor,
          sectorStyle,
        );
      }
    });
  } else {
    const pie = d3
      .pie()
      .value((d) => d.y) // assuming each item in data has a 'y' property
      .startAngle(startAngle)
      .endAngle(endAngle)
      .sort(null);

    pieData = pie(data).map((d) => ({
      ...d,
      filledAngle: d.endAngle - d.startAngle,
      progressEndAngle: d.endAngle,
      progressMidAngle: (d.startAngle + d.endAngle) / 2,
    }));

    // Create donut chart segments using createSector
    pieData.forEach((d) => {
      const sectorGroup = contentGroup.append("g").attr("class", "arc");
      createSector(
        sectorGroup,
        innerRadius,
        outerRadius,
        d.startAngle,
        d.endAngle,
        colorScale(d.data.x),
        sectorStyle,
      );
    });
  }

  // Add labels if showValues is true
  if (showValues) {
    const minLabelRadius = 18;
    pieData.forEach((d) => {
      const angleSpan = useEqualAngleProgress
        ? d.filledAngle
        : d.endAngle - d.startAngle;
      const textFitRadius = (innerRadius + outerRadius) / 2;
      const arcLength = angleSpan * textFitRadius;
      if (outerRadius < minLabelRadius || textFitRadius < minLabelRadius)
        return;

      const color = getTextColor(colorScale(d.data.x));
      const labelOuterRadius = Math.min(
        Math.max(outerRadius, 130),
        outerRadius * 1.2,
      );
      const anchorAngle = useEqualAngleProgress
        ? d.progressMidAngle
        : (d.startAngle + d.endAngle) / 2;
      const total = d3.sum(pieData, (d) => d.value);
      const percentage = total === 0 ? 0 : Math.round((d.value / total) * 100);
      if (percentage < 8) return;

      const percentageWidth =
        `${percentage}%`.length * globalSettings.valueCharWidth;
      const nameWidth = d.data.x.length * globalSettings.valueCharWidth;
      const minArcLength = Math.max(
        percentageWidth,
        globalSettings.valueCharWidth * 3,
      );
      const canShowPercentage = arcLength >= minArcLength;
      const canShowNameAndPercentage =
        showNames &&
        arcLength >= Math.max(nameWidth, percentageWidth) &&
        arcLength >= (nameWidth + percentageWidth) * 0.8;

      if (!canShowPercentage) return;

      let displayText;
      if (canShowNameAndPercentage) {
        displayText = `${d.data.x}\n${percentage}%`;
      } else {
        displayText = `${percentage}%`;
      }

      const labelRadius = (innerRadius + labelOuterRadius) / 2;
      const anchor = getAnglePoint(anchorAngle, labelRadius);
      const element = contentGroup
        .append("g")
        .attr("class", "axis")
        .append("text");

      element
        .attr("transform", `translate(${anchor.x},${anchor.y})`)
        .attr("text-anchor", "middle")
        .attr("alignment-baseline", "middle")
        .style("fill", color)
        .style("font-weight", "bold");

      // Handle multi-line text if we have both label and percentage
      if (displayText.includes("\n")) {
        const lines = displayText.split("\n");
        lines.forEach((line, index) => {
          element
            .append("tspan")
            .attr("x", 0)
            .attr("dy", index === 0 ? "-0.3em" : "1.2em")
            .text(line);
        });
      } else {
        element.text(displayText);
      }

      globalSettings.setFont(element, "label");
    });
  }

  // === Modified: Draw pin and gradient shadow ===
  if (chartStyle === "pin") {
    const shellGroup = g
      .insert("g", ":first-child")
      .attr("class", "pin-shell-layer");
    const shadowGroup = g
      .insert("g", ":first-child")
      .attr("class", "pin-shadow-layer");
    // pin's parameters
    const pinRadius = Math.min(outerRadius * 1.15, outerRadius + 5); // keep a bold rim around the pie content
    const pinTailLen = pinRadius * 1;

    // Coordinates of the tail tip
    const tailX = 0;
    const tailY = pinRadius + pinTailLen;

    // Use the tangent points as the head-to-tail transition, then keep the
    // first Bezier handles on the circle tangents so the shell and tail are
    // visually tangent where they meet.
    const tangentPointY = (pinRadius * pinRadius) / tailY;
    const tangentPointX = Math.sqrt(
      pinRadius * pinRadius - tangentPointY * tangentPointY,
    );
    const p1 = { x: tangentPointX, y: tangentPointY };
    const p2 = { x: -tangentPointX, y: tangentPointY };
    const tangentHandleLen = pinRadius * 0.42;
    const tailBellyX = pinRadius * 0.34;
    const tailBellyY = tailY - pinTailLen * 0.96;

    // Tangent direction of the circular shell at the join points.
    const rightTangent = {
      x: -p1.y / pinRadius,
      y: p1.x / pinRadius,
    };
    const leftTangent = {
      x: -p2.y / pinRadius,
      y: p2.x / pinRadius,
    };
    const rightShoulder = {
      x: p1.x + rightTangent.x * tangentHandleLen,
      y: p1.y + rightTangent.y * tangentHandleLen,
    };
    const leftShoulder = {
      x: p2.x - leftTangent.x * tangentHandleLen,
      y: p2.y - leftTangent.y * tangentHandleLen,
    };

    // Build the SVG path string
    const pinPath = [
      `M ${p2.x} ${p2.y}`,
      `A ${pinRadius} ${pinRadius} 0 1 1 ${p1.x} ${p1.y}`,
      `C ${rightShoulder.x} ${rightShoulder.y} ${tailBellyX} ${tailBellyY} ${tailX} ${tailY}`,
      `C ${-tailBellyX} ${tailBellyY} ${leftShoulder.x} ${leftShoulder.y} ${p2.x} ${p2.y}`,
      "Z",
    ].join(" ");

    // === New: Define and apply a radial gradient for the shadow ===

    // Get the root SVG element to define the gradient
    const svg = d3.select(g.node().ownerSVGElement);

    // Create a <defs> section if it doesn't exist
    let defs = svg.select("defs");
    if (defs.empty()) {
      defs = svg.append("defs");
    }

    // Define the radial gradient if it doesn't exist
    const gradientId = "shadow-gradient";
    if (defs.select(`#${gradientId}`).empty()) {
      const radialGradient = defs
        .append("radialGradient")
        .attr("id", gradientId);

      radialGradient
        .append("stop")
        .attr("offset", "0%")
        .attr("stop-color", globalSettings.textColorDark)
        .attr("stop-opacity", 0.5); // Darkest in the center

      radialGradient
        .append("stop")
        .attr("offset", "100%")
        .attr("stop-color", globalSettings.textColorDark)
        .attr("stop-opacity", 0); // Fades to transparent at the edges
    }

    // Draw the shadow ellipse using the gradient
    shadowGroup
      .append("ellipse")
      .attr("cx", tailX)
      .attr("cy", tailY + 5) // center y of the shadow, slightly below the pin tip
      .attr("rx", tangentPointX * 0.9) // horizontal radius of the shadow
      .attr("ry", 10) // vertical radius of the shadow
      .style("fill", `url(#${gradientId})`);
    shadowGroup.attr("data-shadow-drift-max", tangentPointX * 0.5);

    // Draw the pin (this part is the same as before)
    shellGroup
      .append("path")
      .attr("d", pinPath)
      .attr("fill", globalSettings.textColorDark)
      .attr("stroke", globalSettings.textColorDark)
      .attr("stroke-width", 3)
      .attr("opacity", 1);

    // Optional: Add text inside the pin (this part is the same as before)
    if (options.pinLabel) {
      const element = shellGroup.append("text");
      element
        .attr("x", 0)
        .attr("y", pinRadius + pinTailLen * 0.76)
        .attr("text-anchor", "middle")
        .attr("fill", globalSettings.textColorLight)
        .text(options.pinLabel);
      globalSettings.setFont(element, "label");
    }

    // Move the entire g group upwards (this part is the same as before)
    const pinTipY = pinRadius + pinTailLen;
    const prevTransform = g.attr("transform") || "";
    let newTransform = prevTransform.trim();
    const translateRegex = /translate\(([^)]+)\)/;
    if (translateRegex.test(newTransform)) {
      newTransform = newTransform.replace(translateRegex, (match, p1) => {
        const [x = 0, y = 0] = p1.split(",").map(Number);
        return `translate(${x}, ${y - pinTipY})`;
      });
    } else {
      newTransform = `${newTransform} translate(0, ${-pinTipY})`.trim();
    }
    g.attr("transform", newTransform);

    if (options.enableCoordinateRotation && options.rotationAnchor) {
      enableCoordinatePinRotation(g, options.rotationAnchor, pinTipY);
    }
  }

  if (returns) {
    // For a pie chart, labels are now defaulted to the arc anchor point.
    let returnValues = {};
    pieData.forEach((d) => {
      const anchorAngle = useEqualAngleProgress
        ? d.progressMidAngle
        : (d.startAngle + d.endAngle) / 2;
      const point = getAnglePoint(anchorAngle, outerRadius);
      returnValues[d.data.x] = {
        x: point.x,
        y: point.y,
      };
    });
    return returnValues;
  }
}

/**
 * Creates a vertical small multiples of pie charts.
 * Data format: [{ x: "A", y: 10, label: "Label A" }, { x: "B", y: 20, label: "Label B" }, ...]
 *
 * @param {Object[]} data
 * @param {Object} g
 * @param {number} height
 * @param {number} width
 * @param {string} xAxisPos
 * @param {string} xAxisDir
 * @param {Object} order
 * @param {function} color
 * @param {boolean} showValues
 */
export function createVerticalMultiPie(
  data,
  g,
  height,
  width,
  xAxisPos,
  xAxisDir,
  order,
  color = "steelblue",
  showValues = false,
) {
  if (d3.min(data, (d) => d.y) < 0) {
    throw new Error("Data contains negative values");
  }

  g = g.attr("width", width).attr("height", height).append("g");

  if (Array.isArray(order)) {
    const orderMap = new Map(order.map((item, index) => [item, index]));
    data.sort((a, b) => orderMap.get(a.x) - orderMap.get(b.x));
  }

  const groupedData = d3.group(data, (d) => d.x);
  const keys = Array.from(groupedData.keys());
  const n = keys.length;

  // calculate pie radius according to `height` and `width`
  const innerPadding = 0.2;
  const diameter = Math.min(
    height * (1 - innerPadding),
    width / (n * (1 + innerPadding)),
  );
  const radius = diameter / 2;

  const xScale = d3
    .scaleBand()
    .domain(keys)
    .range(xAxisDir === "default" ? [0, width] : [width, 0])
    .paddingInner(innerPadding)
    .paddingOuter(innerPadding / 2);

  const colorScale = typeof color === "function" ? color : () => color;

  for (let i = 0; i < n; i++) {
    const key = keys[i];
    const pieData = groupedData.get(key).map((d) => ({
      x: d.label,
      y: d.y,
    }));

    const pieGroup = g
      .append("g")
      .attr("class", "pie-group")
      .attr(
        "transform",
        `translate(${xScale(key) + xScale.bandwidth() / 2}, ${height / 2})`,
      );

    createDonutChart(
      pieData,
      pieGroup,
      0,
      2 * Math.PI,
      radius * 0.5,
      radius,
      undefined,
      colorScale,
      showValues,
    );
  }

  if (xAxisPos !== "none") {
    axisCartesian(g, xAxisPos, xScale, width, height);
  }
}
