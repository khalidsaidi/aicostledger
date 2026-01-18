import readline from "node:readline";

export async function waitForEnter(message: string) {
  await askQuestion(message);
}

export async function askQuestion(message: string) {
  return new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
