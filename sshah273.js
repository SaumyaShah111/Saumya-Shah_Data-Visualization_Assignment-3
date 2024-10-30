// Global state
let currentData = null;
let selectedPoints = [];

// Dataset paths
const DATASETS = {
    penguins: 'Penguins.csv',
    pokemon: 'Pokemon.csv',
    test1: '/testing/data/Test1.csv',
    test2: '/testing/data/Test2.csv'
};

// Color scale (using D3's categorical colors)
const colorScale = d3.scaleOrdinal(d3.schemeTableau10);

// Lasso helper function
function createLasso(target, items, onSelect) {
    // Create the lasso instance
    const lasso = target.append("g").attr("class", "lasso-group");

    let lassoPolygon = [];
    let isLassoActive = false;

    // Add the base areas for the lasso
    lasso.append("path")
        .attr("class", "drawn")
        .style("fill", "lightblue")          // Light blue fill
        .style("fill-opacity", 0.3)          // Semi-transparent fill
        .style("stroke", "lightblue")        // Light blue stroke
        .style("stroke-width", "1px");       // Thin stroke

    lasso.append("path")
        .attr("class", "loop_close")
        .style("stroke", "lightblue")        // Light blue stroke for closing loop
        .style("stroke-width", "1px");       // Thin stroke

    const drag = d3.drag()
        .on("start", dragStart)
        .on("drag", dragging)
        .on("end", dragEnd);

    target.call(drag);

    function dragStart(event) {
        lassoPolygon = [[event.x, event.y]];
        isLassoActive = true;

        // Reset all points to semi-transparent
        items.style("opacity", 0.3);

        lasso.select(".drawn").attr("d", null);
        lasso.select(".loop_close").attr("d", null);
    }

    function dragging(event) {
        if (!isLassoActive) return;

        lassoPolygon.push([event.x, event.y]);

        lasso.select(".drawn")
            .attr("d", `M${lassoPolygon.map(p => p.join(",")).join("L")}`);

        // Add closing line
        if (lassoPolygon.length > 2) {
            const close = [
                lassoPolygon[0],
                lassoPolygon[lassoPolygon.length - 1]
            ];
            lasso.select(".loop_close")
                .attr("d", `M${close.map(p => p.join(",")).join("L")}`);
        }
    }

    function dragEnd() {
        if (!isLassoActive || lassoPolygon.length < 3) {
            // If lasso is invalid, reset all points to original opacity
            items.style("opacity", 0.7);
            resetLasso();
            return;
        }

        // Create polygon for hit testing
        const polygon = lassoPolygon.map(p => ({ x: p[0], y: p[1] }));

        // Get SVG coordinates for each point
        const selected = items.filter(function() {
            const bbox = this.getBoundingClientRect();
            const svgElement = d3.select('#scatter-plot').select('svg').node();
            const point = svgElement.createSVGPoint();
            point.x = bbox.x + bbox.width / 2;
            point.y = bbox.y + bbox.height / 2;
            const svgPoint = point.matrixTransform(svgElement.getScreenCTM().inverse());
            return pointInPolygon({ x: svgPoint.x - 60, y: svgPoint.y - 40 }, polygon); // Adjust for margins
        });

        // Update styles
        items.style("opacity", 0.3);
        selected.style("opacity", 0.7);

        if (onSelect) {
            onSelect(selected);
        }

        resetLasso();
    }

    function resetLasso() {
        isLassoActive = false;
        lassoPolygon = [];
        lasso.select(".drawn").attr("d", null);
        lasso.select(".loop_close").attr("d", null);
    }

    // Point in polygon test
    function pointInPolygon(point, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;

            const intersect = ((yi > point.y) !== (yj > point.y))
                && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }
}


function kernelDensityEstimator(kernel, X) {
    return function(V) {
        // Create more sample points for smoother density
        const range = d3.extent(V);
        const bandwidth = (range[1] - range[0]) / 25; // Adjust bandwidth for smoothness
        const x = d3.range(range[0], range[1], bandwidth);
        
        return x.map(x => [
            x,
            d3.mean(V, v => kernel(x - v))
        ]);
    };
}

// Improved Epanechnikov kernel function
function kernelEpanechnikov(bandwidth) {
    return function(v) {
        v = v / bandwidth;
        return Math.abs(v) <= 1 ? 0.75 * (1 - v * v) / bandwidth : 0;
    };
}
// Initialize the visualizations
async function init() {
    // Set up event listeners for controls
    d3.select('#dataset-select').on('change', loadDataset);
    d3.select('#x-select').on('change', updateScatterPlot);
    d3.select('#y-select').on('change', updateScatterPlot);
    d3.select('#color-select').on('change', updateScatterPlot);
    d3.select('#boxplot-select').on('change', updateBoxPlot);
    d3.select('#plot-type').on('change', updateBoxPlot);

    // Load initial dataset
    await loadDataset();
}

// Update select options
function updateSelectOptions(selectId, options) {
    const select = d3.select(selectId);
    select.selectAll('option').remove();
    select.selectAll('option')
        .data(options)
        .enter()
        .append('option')
        .text(d => d)
        .property('value', d => d);
}

// Create scatter plot with transitions
function createScatterPlot() {
    const margin = {top: 40, right: 40, bottom: 100, left: 60};
    const width = 600 - margin.left - margin.right;
    const height = 500 - margin.top - margin.bottom;

    // Get selected attributes
    const xAttr = d3.select('#x-select').property('value');
    const yAttr = d3.select('#y-select').property('value');
    const colorAttr = d3.select('#color-select').property('value');

    // Check if we have valid selections and data
    if (!xAttr || !yAttr || !colorAttr || !currentData) {
        console.log('Missing required data or selections');
        return;
    }

    // Create SVG if it doesn't exist
    let svg = d3.select('#scatter-plot').select('svg');
    let g;
    
    if (svg.empty()) {
        svg = d3.select('#scatter-plot')
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom + 50);
            
        g = svg.append('g')
            .attr('transform', `translate(${margin.left},${margin.top})`);
            
        // Add initial axis groups
        g.append('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(0,${height})`);
            
        g.append('g')
            .attr('class', 'y-axis');
            
        // Add axis labels
        g.append('text')
            .attr('class', 'x-label axis-label')
            .attr('x', width / 2)
            .attr('y', height + margin.bottom - 50)
            .style('text-anchor', 'middle');
            
        g.append('text')
            .attr('class', 'y-label axis-label')
            .attr('transform', 'rotate(-90)')
            .attr('x', -height / 2)
            .attr('y', -margin.left + 20)
            .style('text-anchor', 'middle');
    } else {
        g = svg.select('g');
    }

    // Remove existing lasso group and title
    g.select('.lasso-group').remove();
    g.select('.plot-title').remove();

    // Add title
    g.append('text')
        .attr('class', 'plot-title')
        .attr('x', width / 2)
        .attr('y', -margin.top / 2)
        .attr('text-anchor', 'middle')
        .style('font-size', '16px')
        .text('Scatter Plot');

    // Create scales with proper data parsing
    const xScale = d3.scaleLinear()
        .domain(d3.extent(currentData, d => parseFloat(d[xAttr])))
        .range([0, width])
        .nice();

    const yScale = d3.scaleLinear()
        .domain(d3.extent(currentData, d => parseFloat(d[yAttr])))
        .range([height, 0])
        .nice();

    // Transition duration
    const duration = 750;

    // Update axes with transition
    const xAxis = d3.axisBottom(xScale);
    const yAxis = d3.axisLeft(yScale);

    g.select('.x-axis')
        .transition()
        .duration(duration)
        .call(xAxis);

    g.select('.y-axis')
        .transition()
        .duration(duration)
        .call(yAxis);

    // Update axis labels
    g.select('.x-label')
        .text(xAttr);

    g.select('.y-label')
        .text(yAttr);

    // Data join for points
    const points = g.selectAll('.point')
        .data(currentData, d => d.Name || d['#'] || Math.random());

    // Handle exit with fade out
    points.exit()
        .transition()
        .duration(duration / 2)
        .style('opacity', 0)
        .remove();

    // Handle enter with fade in from random position
    const pointsEnter = points.enter()
        .append('circle')
        .attr('class', 'point')
        .attr('r', 5)
        .style('opacity', 0)
        .style('fill', d => colorScale(d[colorAttr]))
        .style('stroke', '#fff')
        .style('stroke-width', 0.5)
        .attr('cx', d => Math.random() < 0.5 ? -50 : width + 50)
        .attr('cy', d => Math.random() < 0.5 ? -50 : height + 50);

    // Merge enter and update selections
    const mergedPoints = points.merge(pointsEnter)
        .transition()
        .duration(duration)
        .style('opacity', 0.7)
        .style('fill', d => colorScale(d[colorAttr]))
        .attr('cx', d => xScale(parseFloat(d[xAttr])))
        .attr('cy', d => yScale(parseFloat(d[yAttr])));

    // Wait for transitions to complete before initializing lasso and legend
    mergedPoints.end().then(() => {
        // Initialize lasso on the merged selection
        createLasso(g, g.selectAll('.point'), (selected) => {
            selectedPoints = selected.data();
            updateBoxPlot();
        });

        // Create legend
        const values = Array.from(new Set(currentData.map(d => d[colorAttr])));
        const legendHeight = 20;
        const legendSpacing = 5;
        const legendItemWidth = 100;

        // Remove existing legend
        g.select('.legend').remove();

        const legend = g.append('g')
            .attr('class', 'legend')
            .attr('transform', `translate(0, ${-margin.top / 4})`);

        const legendItems = legend.selectAll('.legend-item')
            .data(values)
            .enter()
            .append('g')
            .attr('class', 'legend-item')
            .attr('transform', (d, i) => `translate(${i * legendItemWidth}, 0)`);

        legendItems.append('rect')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', 15)
            .attr('height', 15)
            .style('fill', d => colorScale(d))
            .style('opacity', 0.7);

        legendItems.append('text')
            .attr('x', 20)
            .attr('y', 12)
            .text(d => d)
            .style('font-size', '12px');

        // Center the legend
        const legendWidth = values.length * legendItemWidth;
        legend.attr('transform', `translate(${(width - legendWidth) / 2}, ${height + margin.bottom - 30})`);
    });
}


// Update scatter plot
function updateScatterPlot() {
    createScatterPlot();
}

// Load and update dataset with transitions
async function loadDataset() {
    const dataset = d3.select('#dataset-select').property('value');
    const data = await d3.csv(DATASETS[dataset]);
    
    // Fade out existing points before dataset change
    const svg = d3.select('#scatter-plot').select('svg');
    if (!svg.empty()) {
        svg.selectAll('.point')
            .transition()
            .duration(400)
            .style('opacity', 0);
    }
    
    currentData = data;

    // Determine attribute types
    const attributes = Object.keys(data[0]).filter(key => 
        key !== '#' && key !== 'Name' && key !== 'Type 2'
    );
    
    const quantAttributes = attributes.filter(attr => 
        !isNaN(data[0][attr])
    );
    
    const catAttributes = attributes.filter(attr => 
        isNaN(data[0][attr])
    );

    // Update select options
    updateSelectOptions('#x-select', quantAttributes);
    updateSelectOptions('#y-select', quantAttributes);
    updateSelectOptions('#color-select', catAttributes);
    updateSelectOptions('#boxplot-select', quantAttributes);

    // Create visualizations with delay to allow fade out
    setTimeout(() => {
        createScatterPlot();
        createBoxPlot();
    }, 400);
}

// Create box plot
function createBoxPlot() {
    const margin = {top: 40, right: 100, bottom: 100, left: 60};
    const width = 600 - margin.left - margin.right;
    const height = 500 - margin.top - margin.bottom;

    // Clear existing SVG
    d3.select('#box-plot').select('svg').remove();

    // Create new SVG
    const svg = d3.select('#box-plot')
        .append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom + 50);

    const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // Add selection count background for better visibility
    // 

    // Add selection count with enhanced styling
    svg.append('text')
        .attr('class', 'selection-count')
        .attr('x', 450)  // 10px padding from the background rectangle
        .attr('y', 500)  // Centered vertically in the background rectangle
        .style('font-size', '14px')
        .style('font-weight', 'bold')
        .style('fill', '#000000');

    // Add placeholder text if no selection
    if (!selectedPoints.length) {
        svg.append('text')
            .attr('class', 'placeholder-text')
            .attr('x', width / 2)
            .attr('y', height / 2)
            .style('text-anchor', 'middle')
            .text('Use the lasso tool to select points');
        return;
    }

    updateBoxPlot();
}



// Update box plot
function updateBoxPlot() {
    const plotType = d3.select('#plot-type').property('value');
    const margin = {top: 40, right: 100, bottom: 100, left: 60};
    const width = 600 - margin.left - margin.right;
    const height = 500 - margin.top - margin.bottom;

    const svg = d3.select('#box-plot').select('svg');
    if (svg.empty()) return;

    const g = svg.select('g');

    // Update selection count
    const countText = svg.select('.selection-count')
    .text(`Selected Points: ${selectedPoints.length}`);

// Get the width of the text to size the background rectangle
const textBBox = countText.node().getBBox();

svg.select('.selection-count-bg')
    .attr('width', textBBox.width + 20)  // 10px padding on each side
    .attr('height', textBBox.height + 10);  // 5px padding on top and bottom

// Highlight the count when it changes
countText
    .style('opacity', 1)
    .transition()
    .duration(300)
    .style('opacity', 1);

    svg.select('.placeholder-text').style('opacity', 0);

    const attr = d3.select('#boxplot-select').property('value');
    const colorAttr = d3.select('#color-select').property('value');

    // Group data by color attribute
    const groupedData = d3.group(selectedPoints, d => d[colorAttr]);
    
    // Calculate statistics for each group
    const groupStats = Array.from(groupedData, ([key, values]) => {
        const numericValues = values.map(d => parseFloat(d[attr])).sort(d3.ascending);
        
        if (numericValues.length >= 5) {
            const q1 = d3.quantile(numericValues, 0.25);
            const q3 = d3.quantile(numericValues, 0.75);
            const iqr = q3 - q1;
            const upperFence = q3 + 1.5 * iqr;
            const lowerFence = q1 - 1.5 * iqr;
            
            const outliers = numericValues.filter(v => v < lowerFence || v > upperFence);
            const nonOutliers = numericValues.filter(v => v >= lowerFence && v <= upperFence);
            
            return {
                group: key,
                values: numericValues,
                stats: {
                    min: d3.min(nonOutliers),
                    q1: q1,
                    median: d3.median(numericValues),
                    q3: q3,
                    max: d3.max(nonOutliers)
                },
                outliers: outliers
            };
        } else {
            return {
                group: key,
                values: numericValues,
                insufficient: true
            };
        }
    });

    // Calculate scales
    const allValues = selectedPoints.map(d => parseFloat(d[attr]));
    const yScale = d3.scaleLinear()
        .domain([d3.min(allValues), d3.max(allValues)])
        .range([height, 0])
        .nice();

    const xScale = d3.scaleBand()
        .domain(Array.from(groupedData.keys()))
        .range([0, width])
        .padding(0.5);

    const violinWidth = xScale.bandwidth();

    // Update or create axis
    const yAxis = d3.axisLeft(yScale);
    let yAxisG = g.select('.y-axis');
    
    if (yAxisG.empty()) {
        yAxisG = g.append('g').attr('class', 'y-axis');
    }
    yAxisG.transition().duration(750).call(yAxis);

    // Create plot groups
    const plotGroups = g.selectAll('.plot-group')
        .data(groupStats, d => d.group);

    // Remove old groups
    plotGroups.exit().remove();

    // Create new groups
    const enterGroups = plotGroups.enter()
        .append('g')
        .attr('class', 'plot-group')
        .attr('transform', d => `translate(${xScale(d.group)},0)`);

    // Merge enter and update selections
    const allGroups = plotGroups.merge(enterGroups);

    // Update groups based on plot type
    allGroups.each(function(d, i) {
        const group = d3.select(this);
        const delay = i * 200;

        group.transition()
            .duration(750)
            .delay(delay)
            .attr('transform', d => `translate(${xScale(d.group)},0)`);

        if (plotType === 'violin') {
            // Clear any existing box plot elements
            group.selectAll('.box, .whisker, .cap, .median-line').remove();

            if (!d.insufficient) {
                // Calculate kernel density estimation
                const values = d.values;
                const spread = d3.max(values) - d3.min(values);
                const bandwidth = spread / 15;
                
                const kde = kernelDensityEstimator(
                    kernelEpanechnikov(bandwidth),
                    yScale.ticks(50)
                );
                const density = kde(values);
                
                // Scale density values
                const maxDensity = d3.max(density, d => d[1]);
                const xDensityScale = d3.scaleLinear()
                    .domain([0, maxDensity])
                    .range([0, violinWidth / 2]);

                // Create violin shape
                const violinArea = d3.area()
                    .x0(d => -xDensityScale(d[1]))
                    .x1(d => xDensityScale(d[1]))
                    .y(d => yScale(d[0]))
                    .curve(d3.curveCatmullRom);

                // Update or create violin path
                const violin = group.selectAll('.violin')
                    .data([density]);

                violin.enter()
                    .append('path')
                    .attr('class', 'violin')
                    .merge(violin)
                    .style('fill', colorScale(d.group))
                    .style('opacity', 0)
                    .attr('d', violinArea)
                    .transition()
                    .duration(750)
                    .delay(delay)
                    .style('opacity', 0.7);

                // Add markers for quartiles and median
                const markers = [[d.stats.q1, 'q1'], [d.stats.median, 'median'], [d.stats.q3, 'q3']];
                
                group.selectAll('.violin-marker')
                    .data(markers)
                    .join('line')
                    .attr('class', d => `violin-marker ${d[1]}`)
                    .attr('x1', -violinWidth / 4)
                    .attr('x2', violinWidth / 4)
                    .attr('y1', d => yScale(d[0]))
                    .attr('y2', d => yScale(d[0]))
                    .style('stroke', 'white')
                    .style('stroke-width', d => d[1] === 'median' ? 2 : 1)
                    .style('opacity', 0)
                    .transition()
                    .duration(750)
                    .delay(delay + 300)
                    .style('opacity', 1);
            }
        } else {
            // Box Plot
            group.selectAll('.violin, .violin-marker').remove();

            if (!d.insufficient) {
                const boxWidth = Math.min(60, violinWidth);

                // Create/update box
                const box = group.selectAll('.box')
                    .data([d]);

                box.enter()
                    .append('rect')
                    .attr('class', 'box')
                    .merge(box)
                    .style('fill', colorScale(d.group))
                    .style('opacity', 0)
                    .transition()
                    .duration(750)
                    .delay(delay)
                    .attr('x', -boxWidth / 2)
                    .attr('y', yScale(d.stats.q3))
                    .attr('width', boxWidth)
                    .attr('height', yScale(d.stats.q1) - yScale(d.stats.q3))
                    .style('opacity', 0.7);

                // Create/update median line
                const medianLine = group.selectAll('.median-line')
                    .data([d]);

                medianLine.enter()
                    .append('line')
                    .attr('class', 'median-line')
                    .merge(medianLine)
                    .transition()
                    .duration(750)
                    .delay(delay)
                    .attr('x1', -boxWidth / 2)
                    .attr('x2', boxWidth / 2)
                    .attr('y1', d => yScale(d.stats.median))
                    .attr('y2', d => yScale(d.stats.median))
                    .style('stroke', 'white')
                    .style('stroke-width', 2);

                // Create/update whiskers and caps
                ['min', 'max'].forEach(type => {
                    const whisker = group.selectAll(`.whisker-${type}`)
                        .data([d]);

                    whisker.enter()
                        .append('line')
                        .attr('class', `whisker-${type}`)
                        .merge(whisker)
                        .transition()
                        .duration(750)
                        .delay(delay)
                        .attr('x1', 0)
                        .attr('x2', 0)
                        .attr('y1', type === 'min' ? yScale(d.stats.q1) : yScale(d.stats.q3))
                        .attr('y2', type === 'min' ? yScale(d.stats.min) : yScale(d.stats.max))
                        .style('stroke', '#000');

                    const cap = group.selectAll(`.cap-${type}`)
                        .data([d]);

                    cap.enter()
                        .append('line')
                        .attr('class', `cap-${type}`)
                        .merge(cap)
                        .transition()
                        .duration(750)
                        .delay(delay)
                        .attr('x1', -boxWidth / 4)
                        .attr('x2', boxWidth / 4)
                        .attr('y1', type === 'min' ? yScale(d.stats.min) : yScale(d.stats.max))
                        .attr('y2', type === 'min' ? yScale(d.stats.min) : yScale(d.stats.max))
                        .style('stroke', '#000');
                });

                // Plot outliers if any exist
                const outlierPoints = group.selectAll('.outlier')
                    .data(d.outliers);

                outlierPoints.enter()
                    .append('circle')
                    .attr('class', 'outlier')
                    .merge(outlierPoints)
                    .attr('r', 3)
                    .attr('cx', 0)
                    .attr('cy', d => yScale(d))
                    .style('fill', 'none')
                    .style('stroke', '#000')
                    .style('opacity', 0)
                    .transition()
                    .duration(750)
                    .delay(delay)
                    .style('opacity', 0.7);

                outlierPoints.exit().remove();
            }
        }
    });

    // Add x-axis with rotated labels
    const xAxis = d3.axisBottom(xScale);
    let xAxisG = g.select('.x-axis');
    
    if (xAxisG.empty()) {
        xAxisG = g.append('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(0,${height})`);
    }
    
    
    // Update title and labels
    g.selectAll('.plot-title').remove();
    g.append('text')
        .attr('class', 'plot-title')
        .attr('x', width / 2)
        .attr('y', -margin.top / 2)
        .attr('text-anchor', 'middle')
        .style('font-size', '16px')
        .text(`${plotType === 'violin' ? 'Violin' : 'Box'} Plot of ${attr} by ${colorAttr}`);

    g.selectAll('.y-label').remove();
    g.append('text')
        .attr('class', 'y-label axis-label')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height / 2)
        .attr('y', -margin.left + 20)
        .style('text-anchor', 'middle')
        .text(attr);

    // Create legend with proper timing
    const longestDelay = (groupStats.length - 1) * 200 + 750;
    setTimeout(() => {
        createLegend(svg, colorAttr, 'vertical', width);
    }, longestDelay);
}


function createLegend(container, colorAttr, position = 'below', width) {
    // Remove existing legend
    container.selectAll('.legend').remove();

    // Get unique values for the color attribute
    const values = Array.from(new Set(currentData.map(d => d[colorAttr])));
    
    // Calculate legend dimensions
    const legendItemHeight = 20;
    const legendItemWidth = position === 'horizontal' ? Math.min(150, width / values.length) : 15; // Adjust width for horizontal layout
    const legendHeight = position === 'horizontal' ? 30 : values.length * legendItemHeight; // Adjust height for vertical layout
    
    // Create legend group
    const legend = container.append('g')
        .attr('class', 'legend')
        .attr('transform', position === 'horizontal' 
            ? `translate(${110}, ${469})` // Positioned below the plot
            : `translate(${width + 85}, ${20})`); // Moved 15 pixels to the right for vertical layout

    // Create legend items
    const legendItems = legend.selectAll('.legend-item')
        .data(values)
        .enter()
        .append('g')
        .attr('class', 'legend-item')
        .attr('transform', (d, i) => position === 'horizontal' 
            ? `translate(${i * legendItemWidth}, 0)` 
            : `translate(0, ${i * legendItemHeight})`); // Adjust position based on orientation

    // Add colored rectangles
    legendItems.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', 15)
        .attr('height', 15)
        .style('fill', d => colorScale(d))
        .style('opacity', 0.7);

    // Remove the text labels for vertical legend
    if (position === 'vertical') {
        legendItems.append('text') // Optional: If you want to remove or comment this part entirely
            .attr('x', 20)
            .attr('y', 12)
            .text(d => d) // Remove this line for no text
            .style('font-size', '12px');
    }

    return legend;
}




// Initialize the visualization
init();