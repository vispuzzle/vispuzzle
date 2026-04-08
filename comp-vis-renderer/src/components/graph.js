import { globalSettings } from "../core/global.js";
import * as d3 from "d3";
export function createGraph(
  node,
  source,
  target,
  g,
  strokeColor = "#666",
  fillColor = "#fff",
  extraData,
  options = {},
) {
  const {
    style = "default",
    onNodeDrag,
    showLinkLabel = true,
    maxLinkCount,
  } = options;

  // Define and compute scale ratios for node drawing and links based on style
  // node now carries the real chartType; compute rectRatio dynamically here
  const getRectRatio = (nodeData) => {
    if (style === "nodetrix") {
      if (
        nodeData &&
        nodeData.chartType &&
        nodeData.chartType.endsWith("pie")
      ) {
        return 1 / 1.1;
      }
      return 1 / 1.414;
    }
    return 1;
  };

  // node format:
  // [
  //   { id: "physics", x: 1130.2325307600377, y: 906.6098958285887, r: 300 },
  //   { id: "mathematics", x: 869.613255268868, y: 1093.6190752393725, r: 300 },
  //   { id: "literature", x: 842.3919227249132, y: 780.1351511433057, r: 300 },
  //   { id: "geography", x: 1157.7611116698217, y: 1219.637495216201, r: 300 },
  // ];
  // source format:
  // ['physics', 'physics', 'physics', 'mathematics', 'mathematics']
  // target format:
  // ['mathematics', 'literature', 'geography', 'literature', 'geography']

  g = g.append("g").attr("class", "background"); // as the background layer

  // Map node IDs to node objects for fast lookup
  const nodeMap = new Map(node.map((d) => [d.id, d]));

  // Build link data: each link is {source: nodeObj, target: nodeObj, weight: num, index: i, hidden: boolean}
  const weightsArray = extraData?.weight || new Array(source.length).fill(1);
  let linksRaw = source.map((s, i) => ({
    source: nodeMap.get(s),
    target: nodeMap.get(target[i]),
    weight: weightsArray[i],
    index: i,
    hidden: false,
  }));

  // If maxLinkCount is specified, keep the top maxLinkCount links by weight
  if (
    maxLinkCount !== undefined &&
    typeof maxLinkCount === "number" &&
    maxLinkCount < linksRaw.length
  ) {
    const thresholdWeight = [...weightsArray].sort((a, b) => b - a)[
      maxLinkCount - 1
    ];
    let acceptedCount = 0;
    linksRaw.forEach((link) => {
      // Keep links above the threshold, or equal to the threshold until slots are filled
      if (
        link.weight > thresholdWeight ||
        (link.weight === thresholdWeight && acceptedCount < maxLinkCount)
      ) {
        acceptedCount++;
      } else {
        link.hidden = true;
      }
    });
  }

  // Compute stroke widths
  let strokeWidths = new Array(linksRaw.length).fill(2);
  if (extraData?.weight && extraData.weight.length === linksRaw.length) {
    const weights = extraData.weight;
    const minWeight = Math.min(...weights);
    const maxWeight = Math.max(...weights);
    const weightRange = maxWeight - minWeight;

    strokeWidths = weights.map((w) => {
      if (weightRange === 0) return 2;
      return 2 + ((w - minWeight) / weightRange) * 10; // Linear scaling from 2 to 5
    });
  }

  // Only render non-hidden links, but keep the full mapping for index alignment
  const links = linksRaw.filter((l) => !l.hidden);

  // Compute link endpoints (connect to center or rectangle edge depending on style)
  const getLinkEndpoints = (d) => {
    if (style === "nodetrix") {
      // NodeTrix: connect to rectangle edge
      const dx = d.target.x - d.source.x;
      const dy = d.target.y - d.source.y;
      const angle = Math.atan2(dy, dx);

      // Compute source rectangle edge point
      const srcRatio = getRectRatio(d.source);
      const sr = d.source.r * srcRatio; // Rectangle diagonal-length compensation
      let sx1, sy1;
      if (Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle))) {
        sx1 = d.source.x + sr * Math.sign(Math.cos(angle));
        sy1 = d.source.y + sr * Math.tan(angle) * Math.sign(Math.cos(angle));
      } else {
        sx1 = d.source.x + (sr * Math.cos(angle)) / Math.abs(Math.sin(angle));
        sy1 = d.source.y + sr * Math.sign(Math.sin(angle));
      }

      // Compute target rectangle edge point
      const tgtRatio = getRectRatio(d.target);
      const tr = d.target.r * tgtRatio; // Rectangle diagonal-length compensation
      let sx2, sy2;
      if (Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle))) {
        sx2 = d.target.x - tr * Math.sign(Math.cos(angle));
        sy2 = d.target.y - tr * Math.tan(angle) * Math.sign(Math.cos(angle));
      } else {
        sx2 = d.target.x - (tr * Math.cos(angle)) / Math.abs(Math.sin(angle));
        sy2 = d.target.y - tr * Math.sign(Math.sin(angle));
      }

      return { x1: sx1, y1: sy1, x2: sx2, y2: sy2 };
    } else {
      // Default: connect to center
      return { x1: d.source.x, y1: d.source.y, x2: d.target.x, y2: d.target.y };
    }
  };

  // Draw links (lines)
  const linkSelection = g
    .selectAll("path.link")
    .data(links)
    .enter()
    .append("path")
    .attr("class", "link")
    .attr("d", (d) => {
      const endpoints = getLinkEndpoints(d);
      if (style === "nodetrix") {
        const dx = endpoints.x2 - endpoints.x1;
        const dy = endpoints.y2 - endpoints.y1;
        const angle = Math.atan2(
          d.target.y - d.source.y,
          d.target.x - d.source.x,
        );

        if (Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle))) {
          const offX = Math.sign(dx) * Math.min(40, Math.abs(dx) / 3);
          const x1A = endpoints.x1 + offX,
            y1A = endpoints.y1;
          const x2A = endpoints.x2 - offX,
            y2A = endpoints.y2;
          const midX = (x1A + x2A) / 2;
          return `M${endpoints.x1},${endpoints.y1} L${x1A},${y1A} C${midX},${y1A} ${midX},${y2A} ${x2A},${y2A} L${endpoints.x2},${endpoints.y2}`;
        } else {
          const offY = Math.sign(dy) * Math.min(40, Math.abs(dy) / 3);
          const x1A = endpoints.x1,
            y1A = endpoints.y1 + offY;
          const x2A = endpoints.x2,
            y2A = endpoints.y2 - offY;
          const midY = (y1A + y2A) / 2;
          return `M${endpoints.x1},${endpoints.y1} L${x1A},${y1A} C${x1A},${midY} ${x2A},${midY} ${x2A},${y2A} L${endpoints.x2},${endpoints.y2}`;
        }
      } else {
        return `M${endpoints.x1},${endpoints.y1} L${endpoints.x2},${endpoints.y2}`;
      }
    })
    .attr("stroke", globalSettings.helperColor)
    .attr("fill", "none")
    .attr("stroke-width", (d) => strokeWidths[d.index])
    .on("click", function (event, d) {
      const el = d3.select(this);
      const isHidden = el.classed("user-hidden");
      el.classed("user-hidden", !isHidden);
      el.style("opacity", isHidden ? 1 : 0);

      if (linkLabelSelection) {
        linkLabelSelection
          .filter((l) => l.index === d.index)
          .style("opacity", isHidden ? 1 : 0);
      }
    });

  // Add relationship text labels
  let linkLabelSelection;
  if (
    showLinkLabel &&
    extraData?.relationship &&
    extraData.relationship.length === linksRaw.length
  ) {
    const gtext = g
      .selectAll("text.link-label")
      .data(links)
      .enter()
      .append("text")
      .attr("class", "link-label")
      .attr("x", (d) => (d.source.x + d.target.x) / 2)
      .attr("y", (d) => (d.source.y + d.target.y) / 2)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", globalSettings.textColorDark)
      .attr("font-weight", "bold")
      .each(function (d) {
        const text = String(extraData.relationship[d.index]);
        const lines = text.split("\n");
        const textElement = d3.select(this);

        lines.forEach((line, lineIndex) => {
          textElement.text(line);
        });
      });
    globalSettings.setFont(gtext, "label");
    linkLabelSelection = gtext;
  }
  // Draw nodes (circles or rectangles)
  let nodeSelection;

  if (style === "nodetrix") {
    // NodeTrix style: use rectangles
    nodeSelection = g
      .selectAll("rect")
      .data(node)
      .enter()
      .append("rect")
      .attr("x", (d) => d.x - d.r * getRectRatio(d))
      .attr("y", (d) => d.y - d.r * getRectRatio(d))
      .attr("width", (d) => d.r * getRectRatio(d) * 2)
      .attr("height", (d) => d.r * getRectRatio(d) * 2)
      .attr("fill", fillColor)
      .attr("stroke", strokeColor)
      .attr("stroke-width", 3);
  } else {
    // Default style: use circles
    nodeSelection = g
      .selectAll("circle")
      .data(node)
      .enter()
      .append("circle")
      .attr("cx", (d) => d.x)
      .attr("cy", (d) => d.y)
      .attr("r", (d) => d.r)
      .attr("fill", fillColor)
      .attr("stroke", strokeColor)
      .attr("stroke-width", 3);
  }

  // --- Add interactions ---
  const allElements = [nodeSelection, linkSelection, linkLabelSelection].filter(
    Boolean,
  );

  // Restore styles for all elements
  function restoreAll() {
    allElements.forEach((selection) => {
      selection.style("opacity", function (d) {
        return d3.select(this).classed("user-hidden") ? 0 : 1;
      });
    });
    nodeSelection.attr("stroke-width", 3);
    linkSelection.attr("stroke-width", (d) => strokeWidths[d.index]);

    // Restore all associated chart elements and text
    const svgNode = g.node() && g.node().ownerSVGElement;
    if (svgNode) {
      d3.select(svgNode)
        .selectAll(
          ".chart-layer > g[data-label], .chart-layer > *[data-label][data-moved='true']",
        )
        .style("opacity", 1);
    }
  }

  // Node drag interaction
  const drag = d3
    .drag()
    .on("start", function (event, d) {
      d3.select(this).raise().attr("stroke-width", 5);
    })
    .on("drag", function (event, d) {
      const dx = event.dx;
      const dy = event.dy;
      d.x = event.x;
      d.y = event.y;

      // Update the node position
      if (style === "nodetrix") {
        d3.select(this)
          .attr("x", d.x - d.r * getRectRatio(d))
          .attr("y", d.y - d.r * getRectRatio(d));
      } else {
        d3.select(this).attr("cx", d.x).attr("cy", d.y);
      }

      // Update connected links
      linkSelection.attr("d", (ld) => {
        const endpoints = getLinkEndpoints(ld);
        if (style === "nodetrix") {
          const ldx = endpoints.x2 - endpoints.x1;
          const ldy = endpoints.y2 - endpoints.y1;
          const angle = Math.atan2(
            ld.target.y - ld.source.y,
            ld.target.x - ld.source.x,
          );

          if (Math.abs(Math.cos(angle)) > Math.abs(Math.sin(angle))) {
            const offX = Math.sign(ldx) * Math.min(40, Math.abs(ldx) / 3);
            const x1A = endpoints.x1 + offX,
              y1A = endpoints.y1;
            const x2A = endpoints.x2 - offX,
              y2A = endpoints.y2;
            const midX = (x1A + x2A) / 2;
            return `M${endpoints.x1},${endpoints.y1} L${x1A},${y1A} C${midX},${y1A} ${midX},${y2A} ${x2A},${y2A} L${endpoints.x2},${endpoints.y2}`;
          } else {
            const offY = Math.sign(ldy) * Math.min(40, Math.abs(ldy) / 3);
            const x1A = endpoints.x1,
              y1A = endpoints.y1 + offY;
            const x2A = endpoints.x2,
              y2A = endpoints.y2 - offY;
            const midY = (y1A + y2A) / 2;
            return `M${endpoints.x1},${endpoints.y1} L${x1A},${y1A} C${x1A},${midY} ${x2A},${midY} ${x2A},${y2A} L${endpoints.x2},${endpoints.y2}`;
          }
        } else {
          return `M${endpoints.x1},${endpoints.y1} L${endpoints.x2},${endpoints.y2}`;
        }
      });

      // Update link label position
      if (linkLabelSelection) {
        linkLabelSelection
          .attr("x", (ld) => (ld.source.x + ld.target.x) / 2)
          .attr("y", (ld) => (ld.source.y + ld.target.y) / 2);
      }

      // Trigger callback to allow external logic to sync positions (e.g., move charts)
      if (onNodeDrag) {
        onNodeDrag(d.id, d.x, d.y, dx, dy);
      }
    })
    .on("end", function (event, d) {
      restoreAll();
    });

  nodeSelection.call(drag);

  // Node hover interaction
  nodeSelection
    .on("mouseover", function (event, d) {
      // Dim all elements
      allElements.forEach((selection) => selection.style("opacity", 0.15));

      const svgNode = g.node() && g.node().ownerSVGElement;
      let chartParts;
      if (svgNode) {
        chartParts = d3
          .select(svgNode)
          .selectAll(
            ".chart-layer > g[data-label], .chart-layer > *[data-label][data-moved='true']",
          );
        chartParts.style("opacity", 0.15); // Dim all external sub-chart elements
      }

      // Highlight the current node
      d3.select(this).style("opacity", 1).attr("stroke-width", 5);

      // Highlight connected links and labels
      linkSelection
        .filter((l) => l.source.id === d.id || l.target.id === d.id)
        .style("opacity", function (ld) {
          return d3.select(this).classed("user-hidden") ? 0 : 1;
        })
        .attr("stroke-width", function (ld) {
          // Find the original index of this link to get its correct stroke width
          const index = links.indexOf(ld);
          return strokeWidths[index] + 2;
        });

      if (linkLabelSelection) {
        linkLabelSelection
          .filter((l) => l.source.id === d.id || l.target.id === d.id)
          .style("opacity", function (ld) {
            const linkNode = linkSelection
              .nodes()
              .find((node) => d3.select(node).datum() === ld);
            return linkNode && d3.select(linkNode).classed("user-hidden")
              ? 0
              : 1;
          });
      }

      // Highlight neighbor nodes
      const neighborIds = new Set();
      neighborIds.add(d.id); // Include self so its chart is highlighted as well
      links.forEach((l) => {
        if (l.source.id === d.id) neighborIds.add(l.target.id);
        if (l.target.id === d.id) neighborIds.add(l.source.id);
      });
      nodeSelection.filter((n) => neighborIds.has(n.id)).style("opacity", 1);

      // Highlight related chart elements
      if (chartParts) {
        chartParts
          .filter(function () {
            const label = d3.select(this).attr("data-label");
            return neighborIds.has(label);
          })
          .style("opacity", 1);
      }
    })
    .on("mouseout", restoreAll);

  // Link hover interaction
  linkSelection
    .on("mouseover", function (event, d) {
      // Dim all elements
      allElements.forEach((selection) => selection.style("opacity", 0.15));

      const svgNode = g.node() && g.node().ownerSVGElement;
      let chartParts;
      if (svgNode) {
        chartParts = d3
          .select(svgNode)
          .selectAll(
            ".chart-layer > g[data-label], .chart-layer > *[data-label][data-moved='true']",
          );
        chartParts.style("opacity", 0.15); // Dim all external sub-chart elements
      }

      // Highlight the current link, its label, and endpoint nodes
      d3.select(this)
        .style("opacity", 1)
        .attr("stroke-width", function (ld) {
          const index = links.indexOf(ld);
          return strokeWidths[index] + 2;
        });

      if (linkLabelSelection) {
        linkLabelSelection.filter((l) => l === d).style("opacity", 1);
      }

      nodeSelection
        .filter((n) => n.id === d.source.id || n.id === d.target.id)
        .style("opacity", 1)
        .attr("stroke-width", 5);

      // Highlight chart elements for the two endpoints
      if (chartParts) {
        chartParts
          .filter(function () {
            const label = d3.select(this).attr("data-label");
            return label === d.source.id || label === d.target.id;
          })
          .style("opacity", 1);
      }
    })
    .on("mouseout", restoreAll);
}
