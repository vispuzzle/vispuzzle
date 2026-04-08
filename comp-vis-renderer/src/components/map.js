import * as d3 from "d3";
import {
  geoPath,
  geoMercator,
  geoEqualEarth,
  geoAlbers,
  geoOrthographic,
  geoCentroid,
} from "d3-geo";
import { geoVanDerGrinten } from "d3-geo-projection";
import { globalSettings } from "../core/global.js";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHemisphereFocus(hemisphereFocus) {
  const normalized = String(hemisphereFocus || "all").toLowerCase();
  if (normalized === "north" || normalized === "south") {
    return normalized;
  }
  return "all";
}

function getFeatureCentroidLatitude(feature) {
  const centroid = geoCentroid(feature);
  const latitude = Array.isArray(centroid) ? Number(centroid[1]) : NaN;
  return Number.isFinite(latitude) ? latitude : null;
}

function isFeatureInFocusedHemisphere(feature, focus, latitudeCutoff) {
  if (focus === "all") return true;
  const latitude = getFeatureCentroidLatitude(feature);
  if (latitude === null) return true;
  return focus === "north"
    ? latitude >= latitudeCutoff
    : latitude <= latitudeCutoff;
}

function isPointInFocusedHemisphere(point, focus, latitudeCutoff) {
  if (focus === "all") return true;
  const latitude = Number(point?.latitude);
  if (!Number.isFinite(latitude)) return true;
  return focus === "north"
    ? latitude >= latitudeCutoff
    : latitude <= latitudeCutoff;
}

/**
 * Create a map visualization
 *
 * @param {Object} g - D3-selected SVG group element used to render the map
 * @param {Object[]} geoData - Geographic data in GeoJSON format
 * @param {number} width - Map width
 * @param {number} height - Map height
 * @param {Object} options - Map configuration options
 * @param {string} [options.mapType='mercator'] - Projection type: 'mercator', 'equalEarth', 'albers', 'orthographic', 'vanDerGrinten'
 * @param {number[]} [options.center] - Map center coordinate: [longitude, latitude]
 * @param {number[]} [options.rotate] - Globe rotation angles: [lambda, phi, gamma]
 * @param {number} [options.scale] - Projection scale
 * @param {Object[]} [options.dataPoints] - Data points to show on the map
 * @param {Object} [options.colorScale] - Color scale for region fill
 * @param {string} [options.valueField='value'] - Data field used for color mapping
 * @param {string} [options.hemisphereFocus='all'] - Hemisphere focus: 'all', 'north', 'south'
 * @param {boolean} [options.hideOppositeHemisphere=false] - Whether to hide the non-focused hemisphere
 * @param {number} [options.oppositeHemisphereOpacity=0.18] - Opacity for the non-focused hemisphere
 * @param {number} [options.hemisphereLatitudeCutoff=0] - Latitude cutoff threshold between hemispheres
 * @param {boolean} [options.showBoundaries=true] - Whether to show boundaries
 * @param {string} [options.boundaryColor='#ccc'] - Boundary stroke color
 * @param {number} [options.boundaryWidth=0.5] - Boundary stroke width
 * @param {Object} [options.labels] - Region label options
 * @param {Object} [options.returns] - Return value configuration
 * @returns {Object} An object containing map info for follow-up interactions
 */
export function createMap(geoData, g, width, height, options = {}) {
  // Extract options or set defaults
  const {
    mapType = "mercator",
    center,
    rotate,
    scale,
    dataPoints = [],
    colorScale,
    valueField = "valueField",
    hemisphereFocus = "all",
    hideOppositeHemisphere = false,
    oppositeHemisphereOpacity = 0.18,
    hemisphereLatitudeCutoff = 0,
    showBoundaries = true,
    boundaryColor = "#ccc",
    boundaryWidth = 0.5,
    labels,
    returns = {},
  } = options;

  const normalizedHemisphereFocus = normalizeHemisphereFocus(hemisphereFocus);
  const latitudeCutoff = Number(hemisphereLatitudeCutoff);
  const effectiveLatitudeCutoff = Number.isFinite(latitudeCutoff)
    ? latitudeCutoff
    : 0;
  const deEmphasisOpacity = clamp(Number(oppositeHemisphereOpacity) || 0, 0, 1);

  const focusedFeatures =
    normalizedHemisphereFocus === "all"
      ? geoData.features
      : geoData.features.filter((feature) =>
          isFeatureInFocusedHemisphere(
            feature,
            normalizedHemisphereFocus,
            effectiveLatitudeCutoff,
          ),
        );
  const renderFeatures =
    normalizedHemisphereFocus !== "all" && hideOppositeHemisphere
      ? focusedFeatures
      : geoData.features;

  const getFeatureOpacity = (feature) => {
    if (normalizedHemisphereFocus === "all") return 1;
    if (
      isFeatureInFocusedHemisphere(
        feature,
        normalizedHemisphereFocus,
        effectiveLatitudeCutoff,
      )
    ) {
      return 1;
    }
    return deEmphasisOpacity;
  };

  // Create the map projection
  const normalizedMapType = String(mapType || "mercator").toLowerCase();
  const isOrthographic = normalizedMapType === "orthographic";
  const hasCircularWorldFrame =
    normalizedMapType === "orthographic" ||
    normalizedMapType === "vandergrinten";
  let projection;
  switch (normalizedMapType) {
    case "equalearth":
      projection = geoEqualEarth().fitExtent(
        [
          [0, 0],
          [width, height],
        ],
        { type: "Sphere" },
      );
      break;
    case "vandergrinten":
      projection = geoVanDerGrinten()
        .rotate([0, 0])
        .center([0, 0])
        .fitExtent(
          [
            [0, 0],
            [width, height],
          ],
          { type: "Sphere" },
        );
      break;
    case "orthographic": {
      const globePadding = Math.min(width, height) * 0.04;
      projection = geoOrthographic()
        .fitExtent(
          [
            [globePadding, globePadding],
            [width - globePadding, height - globePadding],
          ],
          { type: "Sphere" },
        )
        .precision(0.1);
      break;
    }
    case "albers":
      projection = geoAlbers();
      break;
    case "mercator":
    default:
      projection = geoMercator();
  }

  // Set projection parameters
  if (!isOrthographic) {
    projection.fitSize([width, height], geoData);
  }

  // Apply custom center if provided
  if (center) {
    if (isOrthographic) {
      projection.rotate([-center[0], -center[1]]);
    } else {
      projection.center(center);
    }
  }

  if (rotate) {
    projection.rotate(rotate);
  }

  if (scale) {
    projection.scale(scale);
  }

  // Create the geographic path generator
  const path = geoPath().projection(projection);

  // Draw base map
  const mapGroup = g
    .append("g")
    .attr("class", "map-container")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("style", "max-width: 100%; height: auto;");

  if (
    normalizedMapType === "equalearth" ||
    isOrthographic ||
    hasCircularWorldFrame
  ) {
    mapGroup
      .append("path")
      .datum({ type: "Sphere" })
      .attr("fill", globalSettings.bcg)
      .attr("stroke", globalSettings.helperColor)
      .attr("stroke-width", 2)
      .attr("d", path);
  }
  // Draw regions
  mapGroup
    .append("g")
    .attr("class", "regions")
    .selectAll("path")
    .data(renderFeatures)
    .enter()
    .append("path")
    .attr("d", path)
    .attr(
      "class",
      (d) =>
        `region ${d.properties.name ? d.properties.name.replace(/\s+/g, "-").toLowerCase() : ""}`,
    )
    .attr("fill", (d) => {
      // If colorScale and valueField are provided, color by value
      if (colorScale && d.properties[valueField] !== undefined) {
        return colorScale(d.properties[valueField]);
      }
      return globalSettings.mapColor.default; // Default fill color
    })
    .attr("fill-opacity", (d) => getFeatureOpacity(d));

  // Add boundaries
  if (showBoundaries) {
    mapGroup
      .append("g")
      .attr("class", "boundaries")
      .selectAll("path")
      .data(renderFeatures)
      .enter()
      .append("path")
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", boundaryColor)
      .attr("stroke-width", boundaryWidth)
      .attr("stroke-opacity", (d) => getFeatureOpacity(d));
  }

  // Return value configuration
  let returnValues = {};
  if (returns.field) {
    const returnFeatures =
      normalizedHemisphereFocus === "all" ? geoData.features : focusedFeatures;
    returnFeatures.forEach((feature) => {
      const name = feature.properties[returns.field];
      let centroid = path.centroid(feature);
      let numRegions = 1; // Default to 1 region
      let regionAreas = [];

      if (feature.geometry && feature.geometry.type === "MultiPolygon") {
        numRegions = feature.geometry.coordinates.length;

        let maxArea = -1;
        let maxAreaIndex = -1;
        let regionCentroids = [];

        feature.geometry.coordinates.forEach((polygon, index) => {
          const singleRegion = {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: polygon,
            },
          };
          const area = d3.geoArea(singleRegion);
          regionAreas.push(area);

          const regionCentroid = path.centroid(singleRegion);
          regionCentroids.push(regionCentroid);

          if (area > maxArea) {
            maxArea = area;
            maxAreaIndex = index;
          }
        });

        if (
          maxAreaIndex >= 0 &&
          regionCentroids[maxAreaIndex] &&
          !isNaN(regionCentroids[maxAreaIndex][0]) &&
          !isNaN(regionCentroids[maxAreaIndex][1])
        ) {
          centroid = regionCentroids[maxAreaIndex];
        }
      } else if (feature.geometry && feature.geometry.type === "Polygon") {
        regionAreas.push(d3.geoArea(feature));
      }

      if (centroid && !isNaN(centroid[0]) && !isNaN(centroid[1])) {
        returnValues[name] = {
          x: centroid[0],
          y: centroid[1],
        };
        if (name == "England") {
          returnValues["UK"] = returnValues[name];
        }
      }
    });
  }

  // Add data point markers
  if (dataPoints && dataPoints.length > 0) {
    const pointGroup = mapGroup.append("g").attr("class", "data-points");
    const visibleDataPoints = dataPoints
      .map((d) => ({
        ...d,
        projected: projection([d.longitude, d.latitude]),
      }))
      .filter((d) => Array.isArray(d.projected))
      .filter(
        (d) =>
          !(
            normalizedHemisphereFocus !== "all" &&
            hideOppositeHemisphere &&
            !isPointInFocusedHemisphere(
              d,
              normalizedHemisphereFocus,
              effectiveLatitudeCutoff,
            )
          ),
      );

    // Add circles for each data point
    pointGroup
      .selectAll("circle")
      .data(visibleDataPoints)
      .enter()
      .append("circle")
      .attr("cx", (d) => d.projected[0])
      .attr("cy", (d) => d.projected[1])
      .attr("r", (d) => d.radius || 5)
      .attr("fill", (d) => d.color || "#ff7f00")
      .attr("fill-opacity", (d) => {
        const baseOpacity = d.opacity || 0.7;
        if (normalizedHemisphereFocus === "all") return baseOpacity;
        if (
          isPointInFocusedHemisphere(
            d,
            normalizedHemisphereFocus,
            effectiveLatitudeCutoff,
          )
        ) {
          return baseOpacity;
        }
        return baseOpacity * deEmphasisOpacity;
      })
      .attr("stroke", (d) => d.strokeColor || "#fff")
      .attr("stroke-width", (d) => d.strokeWidth || 0.5);
  }

  // Add region labels
  if (labels) {
    const labelGroup = mapGroup.append("g").attr("class", "region-labels");

    labelGroup
      .selectAll("text")
      .data(
        (normalizedHemisphereFocus === "all"
          ? geoData.features
          : focusedFeatures
        ).filter((d) => d.properties[labels.field]),
      )
      .enter()
      .append("text")
      .attr("x", (d) => {
        // Use region centroid as label position
        const centroid = path.centroid(d);
        return centroid[0];
      })
      .attr("y", (d) => {
        const centroid = path.centroid(d);
        return centroid[1];
      })
      .text((d) => d.properties[labels.field])
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "central")
      .attr("fill", labels.color || globalSettings.textColorDark)
      .attr("pointer-events", "none");

    labelGroup.selectAll("text").each(function () {
      globalSettings.setFont(d3.select(this), "value");
    });
  }

  return returnValues;
}

/**
 * Create a heatmap layer
 *
 * @param {Object} g - D3-selected SVG group element
 * @param {Function} projection - D3 geographic projection function
 * @param {Object[]} data - Hotspot data, each with longitude/latitude/value
 * @param {Object} options - Heatmap options
 * @param {number} [options.radius=20] - Hotspot radius
 * @param {number} [options.blur=15] - Blur radius
 * @param {Array} [options.colorRange] - Heatmap color range
 */
export function createHeatmap(g, projection, data, options = {}) {
  const {
    radius = 20,
    blur = 15,
    colorRange = ["blue", "cyan", "lime", "yellow", "red"],
  } = options;

  // Create heatmap container
  const heatmapGroup = g.append("g").attr("class", "heatmap");

  // Convert geographic coordinates to pixel coordinates
  const points = data.map((d) => ({
    x: projection([d.longitude, d.latitude])[0],
    y: projection([d.longitude, d.latitude])[1],
    value: d.value,
  }));

  // Create a heatmap using canvas-like radial gradients
  // Note: implementing a full heatmap in SVG is complex; this is a simplified version
  // In real applications, you may want a dedicated heatmap library
  const max = d3.max(data, (d) => d.value);
  const colorScale = d3
    .scaleSequential()
    .domain([0, max])
    .interpolator(d3.interpolateRgbBasis(colorRange));

  // Create a radial gradient for each data point
  points.forEach((point, i) => {
    // Create radial gradient definition
    const gradientId = `heat-gradient-${i}`;
    const gradient = g
      .append("defs")
      .append("radialGradient")
      .attr("id", gradientId)
      .attr("cx", "50%")
      .attr("cy", "50%")
      .attr("r", "50%");

    gradient
      .append("stop")
      .attr("offset", "0%")
      .attr("stop-color", colorScale(point.value))
      .attr("stop-opacity", 0.8);

    gradient
      .append("stop")
      .attr("offset", "100%")
      .attr("stop-color", colorScale(point.value))
      .attr("stop-opacity", 0);

    // Add hotspot circle
    heatmapGroup
      .append("circle")
      .attr("cx", point.x)
      .attr("cy", point.y)
      .attr("r", radius * (point.value / max) + radius / 2)
      .attr("fill", `url(#${gradientId})`)
      .attr("fill-opacity", 0.5)
      .attr("stroke", "none");
  });

  return heatmapGroup;
}

/**
 * Create a contour layer
 */
export function createContours(g, projection, contourData, options = {}) {
  const {
    thresholds = 10,
    color = "steelblue",
    width: mapWidth,
    height: mapHeight,
  } = options;

  const { values, extent } = contourData;

  // Create transforms from geographic coordinates to pixel coordinates
  const geoToPixelX = d3
    .scaleLinear()
    .domain([extent[0], extent[2]])
    .range([0, mapWidth]);

  const geoToPixelY = d3
    .scaleLinear()
    .domain([extent[1], extent[3]])
    .range([mapHeight, 0]);

  // Generate contour paths
  const contourGenerator = d3
    .contours()
    .size([values[0].length, values.length])
    .thresholds(
      typeof thresholds === "number"
        ? d3.range(
            d3.min(values.flat()),
            d3.max(values.flat()),
            (d3.max(values.flat()) - d3.min(values.flat())) / thresholds,
          )
        : thresholds,
    );

  // Rename local variable from contourData to contourLines to avoid shadowing the function parameter
  const contourLines = contourGenerator(values.flat());

  // Convert contour coordinates to geographic coordinates, then to pixels
  const geoPath = d3.geoPath().projection(projection);

  // Add contours
  const contourGroup = g.append("g").attr("class", "contours");

  contourGroup
    .selectAll("path")
    .data(contourLines) // Use the new variable name
    .enter()
    .append("path")
    .attr("d", (d) => {
      // Convert contour coordinates back to geographic coordinates
      const coords = d.coordinates.map((ring) =>
        ring.map((points) =>
          points.map(([x, y]) => [
            extent[0] + ((extent[2] - extent[0]) * x) / values[0].length,
            extent[1] + (extent[3] - extent[1]) * (1 - y / values.length),
          ]),
        ),
      );

      // Convert to GeoJSON format
      const geoJson = {
        type: "MultiPolygon",
        coordinates: coords,
      };

      return geoPath(geoJson);
    })
    .attr("fill", "none")
    .attr("stroke", color)
    // Use the new variable name here as well
    .attr(
      "stroke-opacity",
      (d) => 0.3 + (d.value / d3.max(contourLines, (c) => c.value)) * 0.7,
    )
    .attr("stroke-width", 0.5);

  return contourGroup;
}
