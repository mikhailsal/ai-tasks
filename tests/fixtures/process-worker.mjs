process.on('message', (message) => {
  if (message?.type === 'release') {
    process.send?.({ type: 'released', workerId: process.env.AI_TASKS_WORKER_ID });
    process.disconnect();
    return;
  }

  if (message?.type === 'shutdown') {
    process.exit(0);
  }
});

process.send?.({ type: 'ready', workerId: process.env.AI_TASKS_WORKER_ID });
