# Testing Documentation

This directory contains comprehensive unit and integration tests for the Discord PR Notifications system.

## Test Structure

```
tests/
├── unit/              # Unit tests for individual functions
│   ├── utils/         # Tests for utility functions
│   ├── handlers/      # Tests for event handlers
│   └── index.test.ts   # Tests for main entry point
├── integration/       # Integration tests for complete flows
│   ├── pr-lifecycle.test.ts
│   ├── error-recovery.test.ts
│   └── edge-cases.test.ts
├── mocks/             # Mock factories for GitHub and Discord APIs
├── fixtures/          # Test data fixtures
└── setup.ts           # Test setup and global mocks
```

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only
```bash
npm run test:integration
```

### Watch Mode
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

This will generate:
- Text report in terminal
- JSON report in `coverage/coverage.json`
- HTML report in `coverage/index.html`

## Coverage Goals

- **Unit Tests**: 90%+ coverage for utility functions
- **Handler Tests**: 85%+ coverage for all handlers
- **Integration Tests**: Cover all major event flows
- **Error Handling**: 100% coverage of error paths

## Test Coverage Thresholds

- Lines: 85%
- Functions: 85%
- Branches: 80%
- Statements: 85%

## Writing New Tests

### Unit Tests
- Test individual functions in isolation
- Mock all external dependencies
- Test both success and error cases
- Test edge cases (empty data, special characters, etc.)

### Integration Tests
- Test complete event flows
- Test interactions between handlers
- Test error recovery scenarios
- Test concurrent event handling

### Mocking
- Use `createMockGitHubContext()` for GitHub API mocks
- Use `createDefaultDiscordMocks()` for Discord API mocks
- Mock file system operations when needed
- Mock environment variables

## Test Fixtures

Test fixtures are located in `tests/fixtures/`:
- `github-events/` - Sample GitHub event payloads
- `discord-responses/` - Sample Discord API responses

Use these fixtures to ensure consistent test data across tests.
