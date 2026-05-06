/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: "node",
    rootDir: ".",
    testMatch: ["<rootDir>/src/**/*.test.ts"],
    moduleNameMapper: {
        "^@/(.*)$": "<rootDir>/src/$1",
    },
    transform: {
        "^.+\\.ts$": [
            "ts-jest",
            {
                tsconfig: "<rootDir>/tsconfig.json",
            },
        ],
    },
};
