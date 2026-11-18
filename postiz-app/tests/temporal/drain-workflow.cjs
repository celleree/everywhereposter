const { proxyActivities } = require('@temporalio/workflow');

exports.drainProof = async (queues) => {
  await Promise.all(
    queues.map((taskQueue) =>
      proxyActivities({
        taskQueue,
        startToCloseTimeout: '90 seconds',
        retry: { maximumAttempts: 1 },
      }).hold(taskQueue)
    )
  );
};
