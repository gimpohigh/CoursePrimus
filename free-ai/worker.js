import {DurableObject} from 'cloudflare:workers';
import {createHandler} from './app.js';
import {FreeChatQuota as QuotaStore} from './quota.js';

export class FreeChatQuota extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.quota = new QuotaStore(ctx);
  }
  fetch(request) {return this.quota.fetch(request);}
}

export default {fetch:createHandler()};
