import * as d3 from "d3";

// Get or create a top-level tooltip layer and raise it to front
export function getOrCreateTooltipLayer(svg) {
  let layer = svg.select("g.tooltip-layer");
  if (layer.empty()) {
    layer = svg.append("g").attr("class", "tooltip-layer");
  }
  layer.raise();
  return layer;
}

// Create a tooltip at (x, y) in the local coordinate system of group g
// Options: { text, stroke, fontSize=12, padding=4, cornerRadius=3 }
export function showTooltip(g, x, y, options = {}) {
  const {
    text = "",
    stroke = "#333",
    fontSize = 12,
    padding = 4,
    cornerRadius = 3,
    textColor = "black",
    background = "white",
    className = "line-point-tooltip",
  } = options;

  const svg = d3.select(g.node().ownerSVGElement);
  const layer = getOrCreateTooltipLayer(svg);

  // align tooltip layer with local transform
  const ctm = g.node().getCTM();
  const matrixTransform = ctm
    ? `matrix(${ctm.a},${ctm.b},${ctm.c},${ctm.d},${ctm.e},${ctm.f})`
    : null;

  const tip = layer
    .append("g")
    .attr("class", className)
    .style("pointer-events", "none")
    .attr("transform", matrixTransform);

  const textNode = tip
    .append("text")
    .text(text)
    .attr("x", x)
    .attr("y", y)
    .attr("text-anchor", "middle")
    .attr("font-family", "sans-serif")
    .attr("font-size", `${fontSize}px`)
    .attr("fill", textColor);

  const bbox = textNode.node().getBBox();
  tip
    .insert("rect", "text")
    .attr("x", bbox.x - padding)
    .attr("y", bbox.y - padding + 1)
    .attr("width", bbox.width + padding * 2)
    .attr("height", bbox.height + padding * 2)
    .attr("fill", background)
    .attr("stroke", stroke)
    .attr("stroke-width", 1)
    .attr("rx", cornerRadius)
    .attr("ry", cornerRadius);

  return tip;
}

export function removeTooltip(g, className = ".line-point-tooltip") {
  const svg = d3.select(g.node().ownerSVGElement);
  svg.select(className).remove();
}
