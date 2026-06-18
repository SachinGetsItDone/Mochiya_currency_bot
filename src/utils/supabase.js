const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const ws = require('ws');

const supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
  realtime: {
    transport: ws,
  },
});

module.exports = { supabase };
