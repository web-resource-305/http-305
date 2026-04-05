const request = require("supertest");
const app = require("../app");

describe("app routes", () => {
  test("GET / serves index.html", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("HTTP");
  });

  test("GET /ping returns 200", async () => {
    const res = await request(app).get("/ping");
    expect(res.status).toBe(200);
  });

  test("GET /nonexistent returns 404", async () => {
    const res = await request(app).get("/nonexistent-route-xyz");
    expect(res.status).toBe(404);
  });

  test("GET /pxy/html without url returns 400", async () => {
    const res = await request(app).get("/pxy/html");
    expect(res.status).toBe(400);
  });

  test("GET /pxy/resource/ without url returns 400", async () => {
    const res = await request(app).get("/pxy/resource/");
    expect(res.status).toBe(400);
  });

  test("GET /pxy/dl/ without url returns 400", async () => {
    const res = await request(app).get("/pxy/dl/");
    expect(res.status).toBe(400);
  });
});

describe("delete routes", () => {
  test("GET /delete renders form", async () => {
    const res = await request(app).get("/delete");
    expect(res.status).toBe(200);
    expect(res.text).toContain("Delete from cache");
  });

  test("POST /delete without hash or URL returns 400", async () => {
    const res = await request(app)
      .post("/delete")
      .send("");
    expect(res.status).toBe(400);
    expect(res.text).toContain("Nothing to delete");
  });

  test("POST /delete with invalid hash returns 400", async () => {
    const res = await request(app)
      .post("/delete")
      .send("hash=not-a-valid-hash");
    expect(res.status).toBe(400);
    expect(res.text).toContain("Invalid hash");
  });

  test("POST /delete with non-existent hash returns 404", async () => {
    const res = await request(app)
      .post("/delete")
      .send("hash=0000000000000000000000000000000000000000000000000000000000000000");
    expect(res.status).toBe(404);
    expect(res.text).toContain("Not found");
  });
});

describe("trust proxy", () => {
  test("req.ip reflects X-Forwarded-For through multiple hops", async () => {
    // Render routes through Cloudflare + an internal hop before reaching the app,
    // so X-Forwarded-For has 3 entries: "client-ip, cloudflare-ip, render-internal-ip".
    // With trust proxy = 2, Express strips the 2 rightmost (trusted) hops and
    // resolves req.ip to the leftmost (real client) IP.
    const res = await request(app)
      .get("/ping")
      .set("X-Forwarded-For", "203.0.113.50, 172.70.247.88, 10.17.46.199");
    expect(res.status).toBe(200);
    // /ping renders headers — the response should show the real client IP
    expect(res.text).toContain("203.0.113.50");
  });
});
