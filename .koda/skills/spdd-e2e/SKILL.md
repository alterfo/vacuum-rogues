---
name: spdd-e2e
id: spdd-e2e
category: Development
description: Create and enhance end-to-end (E2E) test suites based on SPDD structured prompts and business requirements, ensuring comprehensive coverage of critical user journeys and acceptance criteria.
---

**Input**: The argument after `/spdd-e2e` includes either:
- A SPDD prompt file reference (e.g., `@spdd/prompt/xxx.md`)
- A feature description with acceptance criteria
- An existing test file to enhance

**Examples**:

```
# Generate E2E tests from SPDD prompt
/spdd-e2e @spdd/prompt/PROMPT-XXX-202603131758-[Feat]-api-token-usage-billing.md

# Create tests from feature description
/spdd-e2e User can complete purchase flow with payment processing

# Enhance existing test suite
/spdd-e2e @src/tests/e2e/purchase-flow.test.ts
Add edge cases for refund scenarios and timeout handling
```

## Context & Purpose

E2E tests validate complete user workflows across all system layers (UI → API → Database → External Services). This skill ensures:

1. **Business requirement coverage** - Each critical user journey is tested end-to-end
2. **Acceptance criteria validation** - All AC from SPDD prompts are verifiable
3. **Integration point verification** - Cross-component interactions work correctly
4. **Failure scenario handling** - Error paths and recovery mechanisms are tested
5. **Performance baseline** - Critical paths meet response time requirements

## Steps

### 1. Validate input and determine scope

**a. If SPDD prompt provided**:
   - Read the entire prompt file
   - Extract **Requirements** section for business context
   - Extract **Acceptance Criteria** from Requirements or Operations
   - Identify critical user journeys from **Operations** section
   - Map entities and their relationships from **Entities** section

**b. If feature description provided**:
   - Use **AskUserQuestion** to clarify:
     > "What are the key acceptance criteria for this feature?"
     > "What are the critical failure scenarios to test?"
     > "Are there existing E2E tests for related functionality?"

**c. If existing test file provided**:
   - Read the test file completely
   - Identify coverage gaps
   - Check alignment with current requirements
   - Determine what enhancements are needed

**d. If no input provided**, use **AskUserQuestion**:
   > "Please provide either:\n" +
   > "- A SPDD prompt file (@spdd/prompt/xxx.md)\n" +
   > "- A feature description with acceptance criteria\n" +
   > "- An existing test file to enhance"

### 2. Analyze project test infrastructure

Before creating tests, understand the testing stack:

**a. Identify E2E testing framework**:
   - Check `package.json` for test dependencies
   - Look for Playwright, Cypress, TestCafe, or Puppeteer configurations
   - Check existing E2E test structure in `src/tests/e2e/` or similar

**b. Review existing patterns**:
   - Read existing E2E test files for style and structure
   - Identify base classes, fixtures, and utilities
   - Check page object model (POM) structure if used
   - Review test data management strategies

**c. Understand test environment**:
   - Check test configuration files (`playwright.config.ts`, `cypress.config.ts`, etc.)
   - Identify base URLs, test environments, and setup/teardown hooks
   - Review environment variable requirements

**d. Check CI/CD integration**:
   - Look for GitHub Actions, GitLab CI, or other pipeline configs
   - Understand test execution triggers and reporting

### 3. Extract test scenarios from requirements

**From SPDD prompt** (if applicable):

a. **Primary happy paths** - From **Operations** section:
   - Each major operation sequence becomes a test scenario
   - Follow the exact flow described in Operations
   - Validate expected outcomes at each step

b. **Edge cases** - From **Safeguards** section:
   - Test all validation rules and constraints
   - Verify error messages match exactly
   - Test boundary conditions

c. **Failure scenarios** - From **Approach** section:
   - Test error handling and recovery
   - Verify rollback mechanisms
   - Test timeout and retry logic

d. **Integration points** - From **Structure** section:
   - Test cross-layer communication
   - Verify data flow between components
   - Test external service interactions

**Test scenario template**:

```
Scenario: [Descriptive name]
Given: [Initial state and preconditions]
When: [User action or system event]
Then: [Expected outcome]
And: [Additional validations]
```

### 4. Design test architecture

**a. Choose testing pattern**:
   - **Page Object Model (POM)** - For UI-heavy tests
   - **Screenplay Pattern** - For complex user interactions
   - **BDD style** - If using Gherkin (Cucumber, SpecFlow)
   - **Component-based** - For micro-frontend architectures

**b. Define test structure**:

```
src/tests/e2e/
  ├── fixtures/              # Test data and fixtures
  │   ├── users.ts          # Test user accounts
  │   ├── products.ts       # Test products/entities
  │   └── environments.ts   # Environment configurations
  │
  ├── page-objects/         # Page object classes
  │   ├── base.page.ts     # Base page with common methods
  │   ├── login.page.ts    # Login page interactions
  │   └── [feature].page.ts # Feature-specific pages
  │
  ├── utils/                # Test utilities
  │   ├── auth.helpers.ts  # Authentication helpers
  │   ├── data.generators.ts # Test data generators
  │   └── wait.helpers.ts  # Custom wait utilities
  │
  ├── specs/                # Test specifications
  │   ├── auth.spec.ts     # Authentication tests
  │   ├── [feature].spec.ts # Feature tests
  │   └── regression.spec.ts # Regression suite
  │
  └── reports/              # Test reports (gitignored)
```

**c. Define test utilities**:
   - Authentication helpers (login/logout)
   - Data setup/teardown utilities
   - Screenshot/video capture on failure
   - API request helpers for hybrid E2E/API testing

### 5. Generate test files

For each test scenario identified:

**a. Create page objects** (if using POM):

```typescript
// Example: src/tests/e2e/page-objects/checkout.page.ts

import { Page, Expect } from '@playwright/test';

export class CheckoutPage {
  constructor(private page: Page) {}

  // Locators
  get cartItems() {
    return this.page.locator('[data-testid="cart-item"]');
  }

  get checkoutButton() {
    return this.page.getByRole('button', { name: 'Proceed to Checkout' });
  }

  get paymentForm() {
    return this.page.locator('[data-testid="payment-form"]');
  }

  // Actions
  async goToCart() {
    await this.page.goto('/cart');
  }

  async proceedToCheckout() {
    await this.checkoutButton.click();
  }

  async fillPaymentForm(cardNumber: string, expiry: string, cvv: string) {
    await this.page.fill('[data-testid="card-number"]', cardNumber);
    await this.page.fill('[data-testid="card-expiry"]', expiry);
    await this.page.fill('[data-testid="card-cvv"]', cvv);
  }

  async submitPayment() {
    await this.page.getByRole('button', { name: 'Pay Now' }).click();
  }

  // Assertions
  async expectCartItemsCount(count: number) {
    await expect(this.cartItems).toHaveCount(count);
  }

  async expectCheckoutButtonVisible() {
    await expect(this.checkoutButton).toBeVisible();
  }

  async expectOrderConfirmation(orderId: string) {
    await expect(this.page.getByText(`Order ${orderId} confirmed`)).toBeVisible();
  }
}
```

**b. Create test specifications**:

```typescript
// Example: src/tests/e2e/specs/checkout.spec.ts

import { test, expect } from '@playwright/test';
import { LoginPage } from '../page-objects/login.page';
import { CatalogPage } from '../page-objects/catalog.page';
import { CheckoutPage } from '../page-objects/checkout.page';

test.describe('Checkout Flow', () => {
  let loginPage: LoginPage;
  let catalogPage: CatalogPage;
  let checkoutPage: CheckoutPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    catalogPage = new CatalogPage(page);
    checkoutPage = new CheckoutPage(page);

    // Setup: User is authenticated
    await test.step('User logs in', async () => {
      await loginPage.navigateTo();
      await loginPage.login('test@example.com', 'password123');
      await loginPage.expectLoginSuccess();
    });
  });

  test('TC-001: Successful checkout with valid payment', async ({ page }) => {
    test.step('Add items to cart', async () => {
      await catalogPage.navigateTo();
      await catalogPage.addToCart('Product A');
      await catalogPage.addToCart('Product B');
    });

    test.step('Proceed to checkout', async () => {
      await checkoutPage.goToCart();
      await checkoutPage.expectCartItemsCount(2);
      await checkoutPage.proceedToCheckout();
    });

    test.step('Complete payment', async () => {
      await checkoutPage.fillPaymentForm('4111111111111111', '12/25', '123');
      await checkoutPage.submitPayment();
    });

    test.step('Verify order confirmation', async () => {
      await checkoutPage.expectOrderConfirmation('ORD-2026-001');
    });
  });

  test('TC-002: Checkout fails with expired card', async ({ page }) => {
    await test.step('Add item to cart', async () => {
      await catalogPage.navigateTo();
      await catalogPage.addToCart('Product A');
    });

    await test.step('Proceed to checkout', async () => {
      await checkoutPage.goToCart();
      await checkoutPage.proceedToCheckout();
    });

    await test.step('Submit with expired card', async () => {
      await checkoutPage.fillPaymentForm('4111111111111111', '01/20', '123');
      await checkoutPage.submitPayment();
    });

    await test.step('Verify error message', async () => {
      await expect(page.getByText('Card has expired. Please use a valid card.')).toBeVisible();
    });
  });

  test('TC-003: Checkout timeout and retry mechanism', async ({ page }) => {
    test.setTimeout(60000);

    await test.step('Add item to cart', async () => {
      await catalogPage.navigateTo();
      await catalogPage.addToCart('Product A');
    });

    await test.step('Simulate slow payment gateway', async () => {
      await page.route('**/api/payment/process', route => {
        setTimeout(() => route.continue(), 30000); // 30s delay
      });
    });

    await test.step('Attempt checkout', async () => {
      await checkoutPage.goToCart();
      await checkoutPage.proceedToCheckout();
    });

    await test.step('Verify retry logic triggers', async () => {
      // Wait for retry mechanism
      await expect(page.getByText('Processing payment...')).toBeVisible({ timeout: 35000 });
    });
  });
});
```

**c. Create test fixtures**:

```typescript
// Example: src/tests/e2e/fixtures/users.ts

export const testUsers = {
  validUser: {
    email: 'test.valid@example.com',
    password: 'TestPassword123!',
    name: 'Test User',
  },
  adminUser: {
    email: 'admin@example.com',
    password: 'AdminPass456!',
    role: 'ADMIN',
  },
  lockedUser: {
    email: 'test.locked@example.com',
    password: 'LockedPass789!',
    accountStatus: 'LOCKED',
  },
};

export const generateUniqueUser = () => ({
  email: `test.${Date.now()}@example.com`,
  password: 'TestPass123!',
  name: `Test User ${Date.now()}`,
});
```

**d. Create helper utilities**:

```typescript
// Example: src/tests/e2e/utils/auth.helpers.ts

import { Page } from '@playwright/test';

export class AuthHelper {
  constructor(private page: Page) {}

  async loginAsUser(user: typeof testUsers.validUser) {
    await this.page.goto('/login');
    await this.page.fill('[data-testid="email"]', user.email);
    await this.page.fill('[data-testid="password"]', user.password);
    await this.page.click('[data-testid="login-button"]');
  }

  async isAuthenticated() {
    const token = await this.page.evaluate(() => 
      localStorage.getItem('auth_token')
    );
    return !!token;
  }

  async logout() {
    await this.page.click('[data-testid="logout-button"]');
  }
}
```

### 6. Map to acceptance criteria

Create a traceability matrix to ensure full coverage:

**Example: Acceptance Criteria Traceability**

| AC ID | Description | Test File | Test Case | Status |
|-------|-------------|-----------|-----------|--------|
| AC-01 | User can login with valid credentials | auth.spec.ts | TC-001 | ✅ |
| AC-02 | System rejects invalid password | auth.spec.ts | TC-002 | ✅ |
| AC-03 | User can view product catalog | catalog.spec.ts | TC-001 | ✅ |
| AC-04 | Checkout requires authentication | checkout.spec.ts | TC-004 | ✅ |
| AC-05 | Payment validation shows specific errors | checkout.spec.ts | TC-002 | ✅ |

### 7. Execute and validate tests

**a. Run tests in development environment**:
   ```bash
   npm run test:e2e
   # or
   npx playwright test
   ```

**b. Check test results**:
   - All tests pass (or document expected failures)
   - No flaky tests
   - Adequate test coverage (>80% critical paths)

**c. Review test reports**:
   - HTML/JSON reports generated
   - Screenshots on failure captured
   - Video recordings available (if configured)

**d. Validate against safeguards**:
   - All error messages match SPDD specifications exactly
   - All constraints are tested
   - All edge cases are covered

### 8. Report generation summary

Provide a summary to the user:

```
✅ E2E test suite created: `src/tests/e2e/`

📋 Test artifacts created:
- Page Objects: 5 files
- Test Specifications: 3 files
- Fixtures: 2 files
- Utilities: 2 files

📊 Coverage:
- Primary user journeys: 100%
- Edge cases: 95%
- Error scenarios: 100%

🎯 Acceptance Criteria Coverage:
- AC-01: ✅ Covered (auth.spec.ts:TC-001)
- AC-02: ✅ Covered (auth.spec.ts:TC-002)
- AC-03: ✅ Covered (catalog.spec.ts:TC-001)
- AC-04: ✅ Covered (checkout.spec.ts:TC-004)
- AC-05: ✅ Covered (checkout.spec.ts:TC-002)

🚀 Next steps:
1. Run: npm run test:e2e
2. Review: npm run test:e2e:report
3. Add to CI: Update .github/workflows/e2e.yml
```

### 9. Integrate with CI/CD (if requested)

**a. Update pipeline configuration**:

```yaml
# Example: .github/workflows/e2e-tests.yml

name: E2E Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test_db
        ports:
          - 5432:5432
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright
        run: npx playwright install --with-deps
      
      - name: Build application
        run: npm run build
      
      - name: Start application
        run: npm run start:test &
        id: start
      
      - name: Wait for application
        run: npx wait-on http://localhost:3000
      
      - name: Run E2E tests
        run: npm run test:e2e
      
      - name: Upload test report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

## Guardrails

- **Do NOT create tests without understanding requirements** - Always read SPDD prompt or clarify AC first
- **Do NOT hardcode sensitive data** - Use environment variables or secure vaults
- **Do NOT create flaky tests** - Ensure tests are deterministic and stable
- **Do NOT skip error scenario testing** - All failure paths must be tested
- **Do NOT ignore test performance** - Tests should complete within reasonable time (typically < 10min total)
- **Do NOT mix unit and E2E concerns** - E2E tests focus on integration, not implementation details
- **Always follow existing project patterns** - Match test structure and style
- **Always include proper cleanup** - Test data must be cleaned up after each test
- **Always use unique test data** - Avoid test interference through data conflicts
- **Always verify against acceptance criteria** - Create traceability matrix

## Test Quality Standards

**Each E2E test must**:

1. ✅ **Be independent** - No test depends on another test's execution
2. ✅ **Have clear setup** - Preconditions are explicitly defined
3. ✅ **Have deterministic behavior** - Same inputs always produce same outcomes
4. ✅ **Include proper assertions** - At least 2 assertions per test (state before + outcome after)
5. ✅ **Handle async operations** - Proper waits for dynamic content
6. ✅ **Include error messages** - Exact match with SPDD Safeguards
7. ✅ **Be self-documenting** - Test names describe business behavior
8. ✅ **Clean up resources** - No data leakage between tests

## Integration with SPDD Workflow

This skill complements the SPDD lifecycle:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     SPDD + E2E Testing Workflow                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Phase 1: Requirements & Design                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ /spdd-reasons-canvas → SPDD Prompt (REASONS Canvas)           │    │
│  │ - Requirements include Acceptance Criteria                     │    │
│  │ - Operations define user journeys                              │    │
│  │ - Safeguards define validation rules                           │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│  Phase 2: Implementation                                                │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ /spdd-generate → Implementation Code                           │    │
│  │ - Unit tests created alongside code                            │    │
│  │ - Integration tests for component interactions                 │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│  Phase 3: E2E Validation                                                │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ /spdd-e2e → E2E Test Suite                                     │    │
│  │ - Extract user journeys from Operations                        │    │
│  │ - Validate all Acceptance Criteria                             │    │
│  │ - Test all Safeguards and error scenarios                      │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│  Phase 4: Continuous Validation                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │ CI/CD Pipeline: Unit → Integration → E2E                       │    │
│  │ - E2E tests run on every PR to main                            │    │
│  │ - Reports generated and archived                               │    │
│  │ - Flaky tests detected and quarantined                         │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Common E2E Test Patterns

### 1. Authentication & Authorization

```typescript
test.describe('Authentication & Authorization', () => {
  test('Unauthenticated user cannot access protected routes', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/login');
  });

  test('Regular user cannot access admin pages', async ({ page, user }) => {
    await loginAs(page, user.validUser);
    await page.goto('/admin/settings');
    await expect(page.getByText('Access Denied')).toBeVisible();
  });
});
```

### 2. Data Flow Across Layers

```typescript
test('Full data flow: Create → Read → Update → Delete', async ({ page }) => {
  const testData = generateUniqueProduct();

  // Create
  await createProductPage.create(testData);
  await expect(page.getByText('Product created successfully')).toBeVisible();

  // Read
  await productListPage.navigateTo();
  await expect(productListPage.getProduct(testData.name)).toBeVisible();

  // Update
  await productListPage.editProduct(testData.name);
  await editProductPage.update({ price: 99.99 });
  await expect(productListPage.getProductPrice(testData.name)).toContainText('99.99');

  // Delete
  await productListPage.deleteProduct(testData.name);
  await expect(productListPage.getProduct(testData.name)).not.toBeVisible();
});
```

### 3. Performance & Load Testing

```typescript
test('Page loads within performance budget', async ({ page }) => {
  const startTime = Date.now();
  await page.goto('/catalog');
  await page.waitForLoadState('networkidle');
  
  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(3000); // 3s budget
});
```

### 4. Cross-Browser Testing

```typescript
test.describe('Cross-browser compatibility', () => {
  test('Checkout works on Chrome', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium');
    await runCheckoutFlow(page);
  });

  test('Checkout works on Firefox', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox');
    await runCheckoutFlow(page);
  });

  test('Checkout works on WebKit', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit');
    await runCheckoutFlow(page);
  });
});
```

## Test Maintenance

When requirements change:

1. **Update SPDD prompt first** - Fix the source of truth
2. **Identify affected tests** - Trace which tests cover changed operations
3. **Update tests to match new requirements** - Keep tests in sync with prompt
4. **Regenerate if using code generation** - Use `/spdd-generate` for test code if configured
5. **Validate full regression suite** - Ensure no unintended breakages

## Output

- Complete E2E test suite following project conventions
- Page objects and utilities
- Traceability matrix linking tests to acceptance criteria
- CI/CD integration (if requested)
- Test execution reports

## When to Use This Skill

✅ **Use `/spdd-e2e` when**:
- New feature requires comprehensive E2E validation
- Acceptance criteria need automated verification
- Critical user journeys need regression protection
- Integration points need validation across layers
- Performance baselines need to be established

❌ **Do NOT use `/spdd-e2e` when**:
- Only unit-level testing is needed (use `/spdd-generate` with unit tests)
- Feature is trivial with no user-facing impact
- Requirements are still unclear or unstable
- Testing budget is insufficient (E2E tests are expensive to maintain)

## Skill execution context
Base directory: /Users/olegsidorkin/SpaceRangers/.koda/skills/spdd-e2e
Use absolute paths only for terminal script execution.
Do not run relative commands like `python3 scripts/...` from the current working directory.
For file tools (`read_file`, `edit_file`, `create_new_file`), use workspace-relative paths (for example, `.koda/skills/<name>/SKILL.md` or `.agents/skills/<name>/SKILL.md`) by default.
