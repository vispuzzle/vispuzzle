# Renderer for Composite Visualization

## For Use

### Display Rendered Result in Browser

```bash
npm install
npm run dev
```

You can change the javascript file path in `src/index.html` to see the results of other examples under `src/examples/`.

### Run Service Locally

```bash
npm install
npm run service
```

You can use the API service by HTTP `PUSH` request on `localhost:9840/render`.

## For Development

If you are using VS Code for development, please make sure that the following extensions are installed:

- EditorConfig for VS Code
- ESLint
- Prettier

Your code will be automatically formatted when it's saved.

Please run

```bash
npm run format
```

before pushing your code to GitHub.

## Currently Supported Features

[This page](https://datavizproject.com/data-type/) lists some common chart types (mainly the four basic chart types: bar, line, scatter, pie, and their variations).

We currently support the following features:

### Bar Chart

- Basic Bar Chart
  - Vertical
  - Horizontal
  - Radial
  - Circular
- Stacked Bar Chart
  - Vertical
  - Horizontal
  - Radial
  - Circular
- Grouped Bar Chart
  - Vertical
  - Horizontal
  - Radial
  - Circular
- Proportional Area Chart
  - Vertical
  - Horizontal
  - Radial (Circular is not supported)

### Line Chart

- (Vertical) [Stacked] Line Chart [linear/step/cardinal]
- Horizontal [Stacked] Line Chart [linear/step/cardinal]
- (Vertical) Area Chart
- Horizontal Area Chart
- Radial [Stacked] Line Chart [linear/step/cardinal]

Todos:

- Stacked Area Chart

### Scatter Chart

- (Vertical) [Stacked] Scatter Chart
- Horizontal [Stacked] Scatter Chart
- Radial [Stacked] Scatter Chart
- Circular [Stacked] Scatter Chart

Todos:

- Bubble Chart

### Pie Chart

- Basic Pie Chart
- Donut Chart
- Semicircle Donut Chart

Todos:

- Sunburst Chart
- Sector Chart
