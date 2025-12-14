import express from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;

// AWS SDK config pointing to LocalStack
const localstackEndpoint = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
const region = process.env.AWS_REGION || 'us-east-1';

AWS.config.update({
  region,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
});

const s3 = new AWS.S3({ endpoint: localstackEndpoint, s3ForcePathStyle: true });
const dynamo = new AWS.DynamoDB.DocumentClient({ endpoint: localstackEndpoint });
const sns = new AWS.SNS({ endpoint: localstackEndpoint });
const sqs = new AWS.SQS({ endpoint: localstackEndpoint });

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

// Ensure LocalStack resources exist on server start (idempotent)
async function ensureResources() {
  const ddb = new AWS.DynamoDB({ endpoint: localstackEndpoint });
  // Ensure DynamoDB table 'Tasks'
  try {
    const tables = await ddb.listTables().promise();
    if (!tables.TableNames.includes('Tasks')) {
      await ddb
        .createTable({
          TableName: 'Tasks',
          AttributeDefinitions: [{ AttributeName: 'taskId', AttributeType: 'S' }],
          KeySchema: [{ AttributeName: 'taskId', KeyType: 'HASH' }],
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        })
        .promise();
      await ddb.waitFor('tableExists', { TableName: 'Tasks' }).promise();
      console.log('[bootstrap] Created DynamoDB table Tasks');
    }
  } catch (e) {
    console.warn('[bootstrap] DynamoDB ensure failed:', e?.message || e);
  }

  // Ensure S3 bucket exists
  try {
    await s3.headBucket({ Bucket: 'shopping-images' }).promise();
  } catch (_) {
    try {
      await s3.createBucket({ Bucket: 'shopping-images' }).promise();
      console.log('[bootstrap] Created S3 bucket shopping-images');
    } catch (e) {
      console.warn('[bootstrap] S3 ensure failed:', e?.message || e);
    }
  }

  // Ensure SNS topic and SQS queue, and subscription
  try {
    // SNS topic
    const topic = await sns.createTopic({ Name: 'task-events' }).promise();
    const topicArn = topic.TopicArn;
    console.log('[bootstrap] SNS topic:', topicArn);

    // SQS queue
    const queue = await sqs.createQueue({ QueueName: 'task-queue' }).promise();
    const queueUrl = queue.QueueUrl;
    const attrs = await sqs.getQueueAttributes({ QueueUrl: queueUrl, AttributeNames: ['QueueArn'] }).promise();
    const queueArn = attrs.Attributes.QueueArn;
    console.log('[bootstrap] SQS queue:', queueUrl);

    // Allow SNS to send to SQS
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'Allow-SNS-SendMessage',
          Effect: 'Allow',
          Principal: { AWS: '*' },
          Action: 'sqs:SendMessage',
          Resource: queueArn,
          Condition: { ArnEquals: { 'aws:SourceArn': topicArn } },
        },
      ],
    };
    await sqs.setQueueAttributes({ QueueUrl: queueUrl, Attributes: { Policy: JSON.stringify(policy) } }).promise();

    // Subscribe SQS to SNS
    await sns
      .subscribe({ TopicArn: topicArn, Protocol: 'sqs', Endpoint: queueArn })
      .promise();
  } catch (e) {
    console.warn('[bootstrap] SNS/SQS ensure failed:', e?.message || e);
  }
}

// POST /upload - accepts multipart (file field: image) or JSON { base64 }
app.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const bucket = 'shopping-images';
    const id = uuidv4();
    const key = `images/${id}.jpg`;

    let buffer;
    let contentType = 'image/jpeg';

    if (req.file) {
      buffer = req.file.buffer;
      contentType = req.file.mimetype || contentType;
    } else if (req.body?.base64) {
      const base64Data = req.body.base64.replace(/^data:.+;base64,/, '');
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      return res.status(400).json({ error: 'No image provided' });
    }

    await s3
      .putObject({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType })
      .promise();

    res.json({ bucket, key, url: `${localstackEndpoint}/${bucket}/${key}` });
  } catch (err) {
    console.error('Upload error', err);
    res.status(500).json({ error: 'Upload failed', details: err?.message });
  }
});

// POST /tasks - save task metadata, publish event and enqueue message
app.post('/tasks', async (req, res) => {
  try {
    const { taskId = uuidv4(), title, description, imageKey } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });

    const item = {
      taskId,
      title,
      description: description || '',
      imageKey: imageKey || null,
      createdAt: new Date().toISOString(),
    };

    await dynamo
      .put({ TableName: 'Tasks', Item: item })
      .promise();

    const topicArn = `arn:aws:sns:${region}:000000000000:task-events`;
    await sns
      .publish({ TopicArn: topicArn, Message: JSON.stringify({ type: 'TASK_CREATED', payload: item }) })
      .promise();

    const queueUrl = `${localstackEndpoint}/000000000000/task-queue`;
    await sqs
      .sendMessage({ QueueUrl: queueUrl, MessageBody: JSON.stringify({ type: 'TASK_CREATED', payload: item }) })
      .promise();

    res.json({ ok: true, task: item });
  } catch (err) {
    console.error('Task error', err);
    res.status(500).json({ error: 'Task creation failed', details: err?.message });
  }
});

ensureResources()
  .catch(() => {})
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
