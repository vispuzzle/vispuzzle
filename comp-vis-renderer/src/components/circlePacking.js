export function createCirclePacking(
  data,
  g,
  strokeColor,
  fillColor,
  rootFillColor,
) {
  // data format:
  // [
  //   {
  //     name: "chart-1",
  //     x: 747.8028213482282,
  //     y: 1019.6149882196058,
  //     r: 289.42954230225615,
  //   },
  //   {
  //     name: "chart-4",
  //     x: 1344.352155416009,
  //     y: 1019.6149882196058,
  //     r: 288.0072755018976,
  //   },
  //   ...
  // ];
  g = g.append("g").attr("class", "background"); // as the background layer
  g.selectAll("circle")
    .data(data)
    .enter()
    .append("circle")
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y)
    .attr("r", (d) => d.r)
    .attr("fill", (d) => (d.name === "root" ? rootFillColor : fillColor))
    .attr("stroke", strokeColor)
    .attr("stroke-width", 2)
    .attr("opacity", 0.9);
}
