# Thesis Testing - Performance Bug Injection

## Overview

This documentation describes the custom performance bugs injected into the OpenTelemetry Demo for testing an AI Agent that automatically detects and fixes performance issues using OpenTelemetry data and GitHub MCP Server.

These bugs are designed to:
1. Be detectable via OpenTelemetry traces (high latency, errors)
2. Be fixable by an AI agent when given the source code
3. Align with Zhao et al.'s classification of performance bug categories

All bugs are controlled via feature flags and are **disabled by default** to preserve normal application functionality.

## Bug Catalog

| Bug ID | Name | Service | Language | Category (Zhao et al.) | Feature Flag | Expected Latency | File Location |
|--------|------|---------|----------|------------------------|--------------|------------------|---------------|
| 1 | Repeated Computation | Product Catalog | Go | Repeated Computation | `thesisRepeatedComputation` | +200-500ms | `src/product-catalog/main.go` |
| 2 | Inefficient Data Structure | Cart | C# | Inefficient Data Structure | `thesisInefficientDataStructure` | Scales with cart size | `src/cart/src/services/CartService.cs` |
| 3 | Inefficient Iteration | Recommendation | Python | Inefficient Iteration | `thesisInefficientIteration` | +500ms+ | `src/recommendation/recommendation_server.py` |
| 4 | Blocking Operation | Payment | Node.js | Multi-threaded Blocking | `thesisBlockingOperation` | +100-200ms | `src/payment/charge.js` |
| 5 | Redundant Processing | Checkout | Go | Redundant Data Processing | `thesisRedundantProcessing` | +400ms+ | `src/checkout/main.go` |

## Bug Details

### Bug 1: Repeated Computation (Product Catalog Service)

**Location:** `src/product-catalog/main.go` - `ListProducts` function

**Description:** When enabled, the service performs unnecessary SHA-256 hash computations inside a loop for each product, along with artificial delays simulating repeated database lookups.

**Performance Impact:**
- 50 hash computations per product
- 20ms delay per product
- Total latency: ~200-500ms depending on catalog size

**Detection:** Look for spans with:
- High latency on `ListProducts` operation
- Attribute `thesis.bug.type` = `repeated_computation`
- Attribute `thesis.bug.enabled` = `true`

### Bug 2: Inefficient Data Structure (Cart Service)

**Location:** `src/cart/src/services/CartService.cs` - `GetCart` method

**Description:** When enabled, uses O(n²) nested loops with List instead of Dictionary for lookups. Linear search through list multiple times per item.

**Performance Impact:**
- 10ms delay per match in first loop
- 5ms delay per match in second loop
- Latency scales with cart size (O(n²))

**Detection:** Look for spans with:
- Increasing latency proportional to cart size
- Attribute `thesis.bug.type` = `inefficient_data_structure`
- Attribute `thesis.bug.enabled` = `true`

### Bug 3: Inefficient Iteration (Recommendation Service)

**Location:** `src/recommendation/recommendation_server.py` - `get_product_list` function

**Description:** When enabled, performs O(n³) triple nested loops over the product list with small delays in the inner loop to simulate expensive comparison operations.

**Performance Impact:**
- 2ms delay per inner loop iteration
- Total latency: 500ms+ depending on product count

**Detection:** Look for spans with:
- High latency on `get_product_list` operation
- Attribute `thesis.bug.type` = `inefficient_iteration`
- Attribute `thesis.bug.enabled` = `true`
- Attribute `app.thesis.comparison_count` showing large number

### Bug 4: Blocking Operation (Payment Service)

**Location:** `src/payment/charge.js` - `charge` function

**Description:** When enabled, performs synchronous file I/O operations and busy-wait loops that block the Node.js event loop.

**Performance Impact:**
- Multiple synchronous file read/write operations
- 100ms busy-wait loop
- Total latency: 100-200ms

**Detection:** Look for spans with:
- High latency on `charge` operation
- Attribute `thesis.bug.type` = `blocking_operation`
- Attribute `thesis.bug.enabled` = `true`
- Event `thesis_blocking_operation_complete`

### Bug 5: Redundant Processing (Checkout Service)

**Location:** `src/checkout/main.go` - `PlaceOrder` function

**Description:** When enabled, processes the same data multiple times: prepares order items 3 times, fetches cart 2 additional times, and calculates totals 3 times with validation delays.

**Performance Impact:**
- 3x order preparation calls (50ms each)
- 2x cart fetch calls (30ms each)
- 3x total calculation passes (10ms per item per pass)
- Total latency: 400ms+

**Detection:** Look for spans with:
- High latency on `PlaceOrder` operation
- Attribute `thesis.bug.type` = `redundant_processing`
- Attribute `thesis.bug.enabled` = `true`

## Setup Instructions

### Enabling/Disabling Bugs via Flagd UI

1. Start the OpenTelemetry Demo:
   ```bash
   docker compose up -d
   ```

2. Access the Flagd UI at: `http://localhost:8080/feature/`

3. Toggle the desired feature flags:
   - `thesisRepeatedComputation` - Bug 1
   - `thesisInefficientDataStructure` - Bug 2
   - `thesisInefficientIteration` - Bug 3
   - `thesisBlockingOperation` - Bug 4
   - `thesisRedundantProcessing` - Bug 5

4. Set the variant to `on` to enable or `off` to disable

### Enabling Bugs via Configuration

Edit `src/flagd/demo.flagd.json` and change the `defaultVariant` for the desired flag:

```json
{
  "thesisRepeatedComputation": {
    "state": "ENABLED",
    "variants": {
      "on": true,
      "off": false
    },
    "defaultVariant": "on"  // Change to "on" to enable by default
  }
}
```

## Verification Steps

### Using Jaeger to Verify Bugs

1. Access Jaeger UI at: `http://localhost:16686`

2. For each bug, search for traces with these criteria:

#### Bug 1 (Repeated Computation)
- Service: `productcatalogservice`
- Operation: `oteldemo.ProductCatalogService/ListProducts`
- Tags: `thesis.bug.enabled=true`

#### Bug 2 (Inefficient Data Structure)
- Service: `cartservice`
- Operation: `oteldemo.CartService/GetCart`
- Tags: `thesis.bug.enabled=true`

#### Bug 3 (Inefficient Iteration)
- Service: `recommendationservice`
- Operation: `get_product_list`
- Tags: `thesis.bug.enabled=true`

#### Bug 4 (Blocking Operation)
- Service: `paymentservice`
- Operation: `charge`
- Tags: `thesis.bug.enabled=true`

#### Bug 5 (Redundant Processing)
- Service: `checkoutservice`
- Operation: `oteldemo.CheckoutService/PlaceOrder`
- Tags: `thesis.bug.enabled=true`

### Expected Span Attributes

All buggy spans include these attributes when the bug is active:
- `code.function` - Name of the function containing the bug
- `code.filepath` - Path to the source file
- `code.namespace` - Namespace/package name
- `thesis.bug.type` - Bug category identifier
- `thesis.bug.enabled` - Boolean indicating bug is active

## OTel Collector Configuration

Sample tail sampling configuration to catch high-latency traces from thesis bugs:

```yaml
processors:
  tail_sampling:
    decision_wait: 10s
    num_traces: 100
    expected_new_traces_per_sec: 10
    policies:
      - name: thesis-bugs-latency
        type: latency
        latency:
          threshold_ms: 200
      - name: thesis-bugs-attribute
        type: string_attribute
        string_attribute:
          key: thesis.bug.type
          values:
            - repeated_computation
            - inefficient_data_structure
            - inefficient_iteration
            - blocking_operation
            - redundant_processing
      - name: thesis-bugs-enabled
        type: string_attribute
        string_attribute:
          key: thesis.bug.enabled
          values:
            - "true"
```

## Integration with AI Agent

### Detection Workflow

1. **Monitor traces:** The AI Agent should monitor Jaeger or receive traces via OTel Collector
2. **Identify high-latency spans:** Look for spans with latency exceeding thresholds:
   - Product Catalog: >200ms
   - Cart Service: Latency scaling with cart size
   - Recommendation: >500ms
   - Payment: >100ms
   - Checkout: >400ms
3. **Check thesis attributes:** Confirm bug presence via `thesis.bug.type` and `thesis.bug.enabled` attributes
4. **Extract code location:** Use `code.function`, `code.filepath`, and `code.namespace` attributes

### Fix Workflow

1. **Fetch source code:** Use GitHub MCP Server to retrieve the file from `code.filepath`
2. **Analyze bug type:** Based on `thesis.bug.type`, apply appropriate fix:

   | Bug Type | Fix Strategy |
   |----------|--------------|
   | `repeated_computation` | Move expensive operations outside loops, cache results |
   | `inefficient_data_structure` | Replace List with Dictionary/HashSet for O(1) lookups |
   | `inefficient_iteration` | Reduce loop nesting, use efficient algorithms |
   | `blocking_operation` | Replace sync operations with async alternatives |
   | `redundant_processing` | Remove duplicate processing, cache intermediate results |

3. **Create PR:** Use GitHub MCP Server to create a Pull Request with the fix
4. **Verify fix:** After deployment, confirm latency returns to normal levels

### Example Detection Query (Jaeger API)

```bash
# Find traces with thesis bugs enabled
curl "http://localhost:16686/api/traces?service=productcatalogservice&tags=thesis.bug.enabled%3Dtrue&limit=20"
```

### Example GitHub MCP Server Usage

```javascript
// Fetch buggy file
const fileContent = await github.getFile({
  owner: 'opentelemetry',
  repo: 'opentelemetry-demo',
  path: 'src/product-catalog/main.go'
});

// Create PR with fix
await github.createPullRequest({
  owner: 'opentelemetry',
  repo: 'opentelemetry-demo',
  title: 'Fix: Remove repeated computation in ListProducts',
  body: 'Detected via OTel trace analysis. Bug type: repeated_computation',
  head: 'fix/repeated-computation',
  base: 'main'
});
```

## Test Verification Checklist

After implementation, verify:

- [ ] Each feature flag can be toggled via flagd UI at `http://localhost:8080/feature/`
- [ ] Load generator creates traffic through affected services
- [ ] Jaeger shows increased latency when bugs are enabled
- [ ] Traces contain the required `code.*` attributes
- [ ] Traces contain `thesis.bug.type` and `thesis.bug.enabled` attributes
- [ ] Services work normally when bugs are disabled
- [ ] No errors occur when feature flags are toggled
