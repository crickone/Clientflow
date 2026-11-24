// Run: npm test -- src/lib/mailgunRouteModel.test.ts
import assert from "node:assert/strict";
import { isUnreachableSmtpError, mailgunFromAddress } from "./mailgunRouteModel";

assert.equal(isUnreachableSmtpError("Connection timeout"), true, "nodemailer's timeout");
assert.equal(isUnreachableSmtpError("connect ETIMEDOUT 91.210.235.155:465"), true, "a socket timeout");
assert.equal(isUnreachableSmtpError("connect ECONNREFUSED 1.2.3.4:587"), true, "refused");
assert.equal(isUnreachableSmtpError("Greeting never received"), true, "no greeting");
assert.equal(isUnreachableSmtpError("Invalid login: 535 Incorrect authentication data"), false, "a wrong password is not a blocked port");
assert.equal(mailgunFromAddress("info@optimalhealthatinspire.ie", "mg.optimalhealthatinspire.ie"), "info@mg.optimalhealthatinspire.ie");
assert.equal(mailgunFromAddress("Hello.There@x.ie", "MG.x.ie"), "hello.there@mg.x.ie");
assert.equal(mailgunFromAddress("", "mg.x.ie"), "hello@mg.x.ie");
console.log("mailgunRouteModel: 8 checks passed.");
