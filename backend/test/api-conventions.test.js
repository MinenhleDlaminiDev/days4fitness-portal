import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/errors/AppError.js";
import { sendData } from "../src/lib/apiResponse.js";
import { errorHandler, notFoundHandler } from "../src/middleware/errorHandler.js";

function responseDouble() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test("success responses use the data envelope", () => {
  const res = responseDouble();
  sendData(res, { id: 1 }, { status: 201 });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { data: { id: 1 } });
});

test("operational errors use the standard error envelope", () => {
  const res = responseDouble();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    errorHandler(new AppError(400, "VALIDATION_ERROR", "Invalid input", { field: "name" }), {}, res);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    error: {
      code: "VALIDATION_ERROR",
      message: "Invalid input",
      details: { field: "name" }
    }
  });
});

test("unknown routes use the standard error envelope", () => {
  const res = responseDouble();
  notFoundHandler({ method: "GET", originalUrl: "/missing" }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, "ROUTE_NOT_FOUND");
});

test("malformed JSON uses a 400 error envelope", () => {
  const res = responseDouble();
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    errorHandler({ type: "entity.parse.failed" }, {}, res);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    error: {
      code: "INVALID_JSON",
      message: "Request body contains invalid JSON"
    }
  });
});

test("oversized JSON uses a 413 error envelope", () => {
  const res = responseDouble();
  errorHandler({ type: "entity.too.large" }, {}, res);

  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.body, {
    error: {
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body exceeds the allowed size"
    }
  });
});
