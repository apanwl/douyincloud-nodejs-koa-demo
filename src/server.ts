import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import Router from '@koa/router'
import Redis from 'ioredis';
import mongoose from 'mongoose';
import assert from "assert";
import fs from 'fs';
import path from 'path';

// Redis / Mongo 未启用时仍可启动，保证首页可访问
async function initService() {
    const {REDIS_ADDRESS, REDIS_USERNAME, REDIS_PASSWORD, MONGO_ADDRESS, MONGO_USERNAME, MONGO_PASSWORD} = process.env;

    let redis: Redis | null = null;
    if (REDIS_ADDRESS) {
        const [ REDIS_HOST, REDIS_PORT] = REDIS_ADDRESS.split(':');
        redis = new Redis({
            port: parseInt(REDIS_PORT, 10),
            host: REDIS_HOST,
            username: REDIS_USERNAME,
            password: REDIS_PASSWORD,
            db: 0,
        });
        assert(await redis.echo('echo') === 'echo', `redis echo error`);
    } else {
        console.log('REDIS_ADDRESS not set, skip redis init');
    }

    if (MONGO_ADDRESS && MONGO_USERNAME && MONGO_PASSWORD) {
        const mongoUrl = `mongodb://${MONGO_USERNAME}:${encodeURIComponent(MONGO_PASSWORD)}@${MONGO_ADDRESS}`;
        await mongoose.connect(mongoUrl);
    } else {
        console.log('Mongo env not set, skip mongo init');
    }

    return {
        redis,
        mongoose,
    }
}

initService().then(async ({ redis, mongoose}) => {
    const kittySchema = new mongoose.Schema({
        name: String
    });

    const Kitten = mongoose.model('Kitten', kittySchema);

    const app = new Koa();

    const router = new Router();
    router.get('/', ctx => {
        const indexPath = path.join(__dirname, '../public/index.html');
        ctx.type = 'html';
        ctx.body = fs.readFileSync(indexPath, 'utf8');
    }).get('/v1/ping', ctx => {
        ctx.body = 'ok';
    }).get('/api/get_data_from_redis', async(ctx) => {
        if (!redis) {
            ctx.status = 503;
            ctx.body = { success: false, message: 'redis not enabled' };
            return;
        }
        const key = ctx.query.key as string;
        assert(key?.trim(), `key is required`);
        const value = await redis.get(key);
        if (value) {
            ctx.body = {
                success: true,
                data: value,
            }
        } else {
            ctx.status = 404;
            ctx.body = {
                success: false,
                message: `${key} not exist`,
            }
        }
    }).post('/api/set_data_to_redis', async(ctx) => {
        if (!redis) {
            ctx.status = 503;
            ctx.body = { success: false, message: 'redis not enabled' };
            return;
        }
        const key = ctx.query.key as string;
        const body: any = ctx.request.body;
        const value = body.value as string;
        assert(key?.trim(), `key is required`);
        assert(value?.trim(), `value is required`);
        await redis.set(key, value);
        ctx.body = {
            success: true,
        }
    }).get('/api/get_data_from_mongodb', async(ctx) => {
        if (mongoose.connection.readyState !== 1) {
            ctx.status = 503;
            ctx.body = { success: false, message: 'mongodb not enabled' };
            return;
        }
        const name = ctx.query.name as string;
        assert(name?.trim(), `name is required`);
        const data = await Kitten.findOne({ name});
        
        if (data) {
            ctx.body = {
                success: true,
                data: data.toJSON(),
            }
        } else {
            ctx.status = 404;
            ctx.body = {
                success: false,
                message: `${name} not exist`,
            }
        }
    }).post('/api/set_data_to_mongodb', async(ctx) => {
        if (mongoose.connection.readyState !== 1) {
            ctx.status = 503;
            ctx.body = { success: false, message: 'mongodb not enabled' };
            return;
        }
        const name = ctx.query.name as string;
        assert(name?.trim(), `name is required`);

        const kit = new Kitten({ name });
        await kit.save();

        ctx.body = {
            success: true,
        }
    });

    app.use(bodyParser());
    app.use(router.routes());

    const PORT = 8000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });

}).catch((error: string) => console.log("Init service  error: ", error));
