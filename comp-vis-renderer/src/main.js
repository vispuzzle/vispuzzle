import { pipeline } from "./core/pipeline.js";
import visTree from "./examples/basic/vis_tree2.json";
import * as d3 from "d3";

document.addEventListener("DOMContentLoaded", () => {
  const vizElement = d3.select("#viz");

  if (!vizElement.empty()) {
    const svg = vizElement
      .append("svg")
      .attr("width", 3000)
      .attr("height", 3000)
      .style("border", "1px solid black"); // Add border for debugging

    pipeline(svg, document, visTree, true, false).catch((error) => {
      console.error("Error generating config:", error);
    });
  } else {
    console.error("#viz element not found");
  }
});
