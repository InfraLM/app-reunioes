const { google } = require("googleapis");

console.log("Check google.meet availability:");
console.log("typeof google.meet:", typeof google.meet);

if (typeof google.meet !== 'function') {
    console.log("Listing keys starting with 'm' in google object:");
    console.log(Object.keys(google).filter(k => k.startsWith("m")));
}

try {
    const meet = google.meet("v2");
    console.log("google.meet('v2') Success!");
} catch (error) {
    console.error("Error calling google.meet('v2'):", error.message);
}
