import { pipeline } from "./core/pipeline.js";
import { extractAndOutputSvg } from "./core/postprocess.js";
import express from "express";
import bodyParser from "body-parser";
import swaggerUi from "swagger-ui-express";
import swaggerJSDoc from "swagger-jsdoc";
import * as d3 from "d3";
import { JSDOM } from "jsdom";

const app = express();
const port = 9840;

app.use(bodyParser.json({ limit: "50mb" }));

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: "3.0.0", // Use OpenAPI 3.0
    info: {
      title: "Visualization Tree Renderer API",
      version: "1.0.0",
      description: "API to generate SVG images based on JSON data",
    },
  },
  apis: ["./index.js"], // Files used to generate Swagger docs
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

// Serve API docs with Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /render:
 *   post:
 *     summary: Generate an SVG image from JSON data
 *     description: Generate an SVG image based on the provided JSON visualization tree data.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Successfully generated the SVG.
 *         content:
 *           image/svg+xml:
 *             schema:
 *               type: string
 *               example: '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="100"><rect width="150" height="100" fill="blue"/></svg>'
 *       400:
 *         description: Invalid JSON data or generation failed.
 */
app.post("/render", async (req, res) => {
  const visTree = req.body;
  console.log(visTree);

  try {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
    const document = dom.window.document;
    const svg = d3
      .select(document.createElementNS("http://www.w3.org/2000/svg", "svg"))
      .attr("width", 2000)
      .attr("height", 2000)
      .attr("xmlns", "http://www.w3.org/2000/svg")
      .attr("xmlns:xlink", "http://www.w3.org/1999/xlink");
    document.body.appendChild(svg.node());
    let svgResult = null;
    let chartResult = null;
    let documentResult = null;
    let chartConfigs = {};
    let baseColorProportion = 0;
    let proximity = null;
    try {
      const result = await pipeline(svg, document, visTree, true, true);
      // console.log("Pipeline result:", result);
      documentResult = result.document;
      chartResult = result.results;
      proximity = result.proximity;
      for (let i = 0; i < chartResult.length; i++) {
        const [charts, polar] = chartResult[i];
        for (const chart of charts[0]) {
          chartConfigs[chart.id] = chart.config;
        }
        for (const chart of charts[1]) {
          chartConfigs[chart.id] = chart.config;
        }
      }
      svgResult = await extractAndOutputSvg(
        documentResult,
        result.width,
        result.height,
      );
      baseColorProportion = result.baseColorProportion;
    } catch (error) {
      console.error("Error generating config:", error);
      if (error?.code === "LINK_PATH_NOT_FOUND") {
        return res.status(500).send({
          error: "Error generating config. Link path not found.",
          code: error.code,
          details: error.pathContext || null,
        });
      }
      return res
        .status(500)
        .send({ error: "Error generating config. " + error });
    }

    const acceptHeader = req.get("Accept");
    if (acceptHeader && acceptHeader.includes("application/json")) {
      console.log("Returning JSON response");
      res.header("Content-Type", "application/json");
      res.send({
        svg: svgResult,
        chartConfigs: chartConfigs,
        baseColorProportion: baseColorProportion,
        proximity: proximity,
      });
    } else {
      console.log("Returning SVG response");
      res.header("Content-Type", "image/svg+xml");
      res.send(svgResult);
    }
  } catch (error) {
    console.error(error);
    res.status(400).send({ error: "Invalid JSON data or generation failed." });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
