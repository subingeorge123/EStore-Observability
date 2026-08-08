import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

if (!__ENV.BASE_URL) {
  throw new Error("BASE_URL is required. Example: k6 run -e BASE_URL=http://<node-ip>:30000 load-tests/checkout-flow.k6.js");
}

const baseUrl = __ENV.BASE_URL.replace(/\/$/, "");
const scenarioName = (__ENV.SCENARIO || "steady").toLowerCase();
const sleepSeconds = Number(__ENV.SLEEP_SECONDS || "1");

const TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiZGVtbyIsImV4cCI6MTc4NjE1NDA1MH0.BxQqAW99ZozF0Zvy1-71S4gh6kgwGhsALIYS0onk-2g";

const products = [
  { name: "Laptop", price: 999 },
  { name: "Phone", price: 699 },
  { name: "Headphones", price: 199 },
  { name: "Watch", price: 249 },
  { name: "Tablet", price: 399 },
  { name: "Camera", price: 549 },
];

export const checkoutDuration = new Trend("checkout_duration");
export const checkoutFailures = new Rate("checkout_failures");

const scenarioProfiles = {
  steady: {
    checkout_flow: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || "5"),
      duration: __ENV.DURATION || "3m",
    },
  },
  spike: {
    checkout_flow: {
      executor: "ramping-vus",
      stages: [
        { duration: __ENV.WARMUP_DURATION || "30s", target: Number(__ENV.BASE_VUS || "5") },
        { duration: __ENV.SPIKE_RAMP_DURATION || "30s", target: Number(__ENV.SPIKE_VUS || "20") },
        { duration: __ENV.SPIKE_HOLD_DURATION || "1m", target: Number(__ENV.SPIKE_VUS || "20") },
        { duration: __ENV.RECOVERY_DURATION || "30s", target: Number(__ENV.BASE_VUS || "5") },
        { duration: __ENV.COOLDOWN_DURATION || "30s", target: Number(__ENV.BASE_VUS || "5") },
        { duration: "10s", target: 0 },
      ],
    },
  },
  ramp: {
    checkout_flow: {
      executor: "ramping-vus",
      stages: [
        { duration: __ENV.RAMP_UP_DURATION || "3m", target: Number(__ENV.PEAK_VUS || "50") },
        { duration: __ENV.PEAK_DURATION || "2m", target: Number(__ENV.PEAK_VUS || "50") },
        { duration: __ENV.RAMP_DOWN_DURATION || "2m", target: 0 },
      ],
    },
  },
};

if (!scenarioProfiles[scenarioName]) {
  throw new Error(`Invalid SCENARIO=${scenarioName}. Use one of: steady, spike, ramp`);
}

export const options = {
  scenarios: scenarioProfiles[scenarioName],
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<3000"],
    checkout_failures: ["rate<0.05"],
  },
};

export default function () {
  const order = randomOrder();
  const startedAt = Date.now();
  const res = http.post(
    `${baseUrl}/api/auth/place-order`,
    JSON.stringify(order),
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      tags: {
        endpoint: "place-order",
      },
    }
  );
  checkoutDuration.add(Date.now() - startedAt);

  const orderOk = check(res, {
   "order status is 200": (r) => r.status === 200,
    "order completed": (r) => r.json("status") === "success",
    "order has id": (r) => Boolean(r.json("order_id")),
  });

  checkoutFailures.add(orderOk ? 0 : 1);
  sleep(sleepSeconds);
}

function randomOrder() {
  const itemCount = Math.floor(Math.random() * 3) + 1;
  const items = [];
  let total = 0;

  for (let i = 0; i < itemCount; i += 1) {
    const product = products[Math.floor(Math.random() * products.length)];
    items.push(product.name);
    total += product.price;
  }

  return { items, total };
}
