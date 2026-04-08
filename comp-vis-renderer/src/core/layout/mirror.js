import { approxAxisMargin } from "../../utils/adjust.js";
import {
  setBoundingBox,
  updateCentroid,
  updatePolarConfig,
} from "../../utils/geometry.js";
import {
  extractChartType,
  extractCondition,
  extractOperation,
  getUnionValues,
} from "../../utils/node.js";
import { recommendAspectRatio } from "../aspect.js";
import { globalSettings } from "../global.js";
import { columnAggregate } from "../../utils/maths.js";

export function handleMirrorMode(root) {
  chartTypeDerivation(root);
  initBasicCharts(root);
  generateLayout(root);
}

export function postprocessMirrorMode(root) {
  setColorsForBasicCharts(root);
  setBoundingBox(root);
}

function chartTypeDerivation(root) {
  if (root.children.length !== 2) {
    throw new Error("Mirror mode requires exactly two child nodes.");
  }

  const direction = root.spatial_arrangement;
  let orientationStr = "v";
  switch (direction) {
    case "vertical":
      orientationStr = "v";
      break;
    case "horizontal":
      orientationStr = "h";
      break;
    case "circular":
      orientationStr = "c";
      break;
    case "radial":
      throw new Error("Radial mirror pattern is not supported.");
  }

  const coordSys = orientationStr === "c" ? "polar" : "cartesian";
  root.coordinate_system = coordSys;

  root.children.forEach((child) => {
    child.chart_type = orientationStr + child.chart_type;
    child.coordSys = coordSys;
  });
}

function initBasicCharts(root) {
  let cx = 1000;
  let cy = 1000;

  // register color map
  const unionName = extractOperation(root.operation)[1];
  const unionValues = getUnionValues(root, unionName);
  globalSettings.registerColorMap(unionName, unionValues, true);

  for (const node of root.children) {
    // register order map
    let order = null;
    if (node.X.data[0].every((x) => typeof x === "string")) {
      if (!globalSettings.orderMaps[node.X.name]) {
        globalSettings.registerOrderMap(
          node.X.name,
          node.X.data[0],
          columnAggregate(node.Y.data),
        );
      }
      order = globalSettings.orderMaps[node.X.name];
      order = Object.keys(order).sort((a, b) => order[a] - order[b]);
    }

    const chartType = extractChartType(node.chart_type);
    let radius = 200;
    let angle = Math.PI * 2;
    let width = 400;
    let height = 400;

    const aspectRatio = recommendAspectRatio(node)[0];
    if (aspectRatio > 1) height = width / aspectRatio;
    else width = height * aspectRatio;

    let xAxisName = node.X.name;
    let yAxisName = node.Y.name;
    if (["h", "c"].includes(chartType[0]))
      [xAxisName, yAxisName] = [yAxisName, xAxisName];

    let yMax = Math.max(...node.Y.data.flat());
    let yMin = Math.min(...node.Y.data.flat());
    if (yMin > 0 && node.chart_type.endsWith("bar")) yMin = 0;

    const chart = {
      X: node.X,
      Y: node.Y,
      config: {
        top: 0,
        left: 0,
        height: height,
        width: width,
        innerRadius: 100,
        outerRadius: 100 + radius,
        startAngle: 0,
        endAngle: angle,
        cx: cx,
        cy: cy,
        order: order,
        color: null,
        xAxis: {
          display: "none",
          direction: "default",
          name: xAxisName,
        },
        yAxis: {
          display: "none",
          direction: "default",
          name: yAxisName,
        },
        yMin: yMin,
        yMax: yMax,
        options: {},
      },
      chartType: node.chart_type,
    };
    if (node.chart_type === "vline" || node.chart_type === "vscatter") {
      chart.config.yAxis.display = "left_noname";
    } else if (node.chart_type === "hline" || node.chart_type === "hscatter") {
      chart.config.xAxis.display = "bottom_noname";
    }
    node.chart = chart;
  }
}

function generateLayout(root) {
  let margin = 20;
  let marginAngle = (20 / 180) * Math.PI;
  let rotate = false;
  const cfg0 = root.children[0].chart.config;
  const cfg1 = root.children[1].chart.config;
  const axisValues = cfg0.order;

  const scaleType = root.children[0].chart_type.endsWith("bar")
    ? "band"
    : "point";

  const axisNode = {
    vis_type: "basic",
    chart_type: "mirror-axis",
    parent: root,
    coordinate_system: root.coordinate_system,
    children: [],
    chart: {
      chartType: "mirror-axis",
      config: {
        top: cfg0.top,
        left: cfg0.left,
        width: cfg0.width,
        height: cfg0.height,
        innerRadius: cfg0.innerRadius,
        outerRadius: cfg0.outerRadius,
        startAngle: cfg0.startAngle,
        endAngle: cfg0.endAngle,
        cx: cfg0.cx,
        cy: cfg0.cy,
        color: globalSettings.textColorDark,
        dir: null,
        rotate: false,
        scaleType: scaleType,
      },
      data: axisValues,
    },
  };
  const axisCfg = axisNode.chart.config;

  switch (root.spatial_arrangement) {
    case "vertical":
      {
        [margin, rotate] = approxMargin(axisValues, "v", cfg0);
        cfg1.left = cfg0.left;
        cfg1.top = cfg0.top + cfg0.height + margin;
        cfg1.width = cfg0.width;
        cfg1.height = cfg0.height;
        cfg1.yAxis.direction = "inverse";

        axisCfg.top = cfg0.top + cfg0.height;
        axisCfg.height = margin;
        axisCfg.dir = "v";
        axisCfg.rotate = rotate;

        updateCentroid(cfg0);
        updateCentroid(cfg1);
      }
      break;
    case "horizontal":
      {
        [margin, rotate] = approxMargin(axisValues, "h", cfg0);
        cfg1.left = cfg0.left + cfg0.width + margin;
        cfg1.top = cfg0.top;
        cfg1.width = cfg0.width;
        cfg1.height = cfg0.height;
        cfg0.xAxis.direction = "inverse";

        axisCfg.left = cfg0.left + cfg0.width;
        axisCfg.width = margin;
        axisCfg.dir = "h";
        axisCfg.rotate = rotate;

        updateCentroid(cfg0);
        updateCentroid(cfg1);
      }
      break;
    case "circular":
      {
        [marginAngle, rotate] = approxMargin(axisValues, "c", cfg0);
        cfg1.innerRadius = cfg0.innerRadius;
        cfg1.outerRadius = cfg0.outerRadius;
        cfg0.startAngle = marginAngle / 2;
        cfg0.endAngle = Math.PI - marginAngle / 2;
        cfg1.startAngle = Math.PI + marginAngle / 2;
        cfg1.endAngle = 2 * Math.PI - marginAngle / 2;
        cfg1.xAxis.direction = "inverse";

        axisCfg.startAngle = cfg1.endAngle - Math.PI * 2;
        axisCfg.endAngle = cfg0.startAngle;
        axisCfg.dir = "c";
        axisCfg.rotate = rotate;

        cfg0.xAxis.display = "top";
        cfg1.xAxis.display = "top";

        cfg0.xAxis.size =
          approxAxisMargin(root.children[0], "x", false, false) + 20;
        cfg1.xAxis.size =
          approxAxisMargin(root.children[1], "x", false, false) + 20;

        updatePolarConfig(cfg0);
        updatePolarConfig(cfg1);
      }
      break;
  }

  // set chart options
  const type = root.children[0].chart_type;
  if (type.endsWith("bar")) {
    root.children.forEach((child) => {
      const options = child.chart.config.options;
      options.style = "round";
      options.showBaseline = false;
      options.autoAdjust = false;
      if (root.spatial_arrangement === "circular") {
        // circular bar chart
        options.showBcgBar = false;
        options.showBorder = true;
      }
    });
  }

  // set axis range
  const yMin = Math.min(cfg1.yMin, cfg0.yMin);
  const yMax = Math.max(cfg1.yMax, cfg0.yMax);
  [cfg0, cfg1].forEach((cfg) => {
    cfg.yMin = yMin;
    cfg.yMax = yMax;
  });

  // add mirror-axis node
  root.children.push(axisNode);
}

function setColorsForBasicCharts(root) {
  const unionName = extractOperation(root.operation)[1];
  const [colorMap, _] = globalSettings.palette.getColorMap(unionName);
  root.children.forEach((node) => {
    if (node.chart_type === "mirror-axis") return;
    const value = extractCondition(node.conditions)[unionName];
    node.chart.config.color = colorMap(value);
  });
}

function approxMargin(values, direction, cfg) {
  const defaultMargin = 20;
  const defaultMarginAngle = (20 / 180) * Math.PI;
  const charWidth = globalSettings.valueCharWidth;

  const formattedText = values.map((v) => globalSettings.format(v));
  const totalTickLength = formattedText.reduce(
    (acc, val) => acc + String(val).length,
    0,
  );
  const maxTickLength = Math.max(...formattedText.map((v) => String(v).length));
  const tickWidth = maxTickLength * charWidth;
  let rotateFlag = false; // whether to rotate the axis labels
  let axisMargin = 0;

  switch (direction) {
    case "v": {
      if (totalTickLength * charWidth <= cfg.width) axisMargin = defaultMargin;
      else {
        axisMargin = tickWidth + defaultMargin;
        rotateFlag = true;
      }
      break;
    }
    case "h": {
      axisMargin = tickWidth + defaultMargin;
      break;
    }
    case "c": {
      axisMargin = Math.max(
        defaultMarginAngle,
        (tickWidth + defaultMargin) / cfg.innerRadius,
      );
      break;
    }
  }

  return [axisMargin, rotateFlag];
}
