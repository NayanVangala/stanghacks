import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://efyjrkdblyfzpvthohyi.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmeWpya2RibHlmenB2dGhvaHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NzY0MjEsImV4cCI6MjA4ODI1MjQyMX0.nZZnx5wmUHvpI3G9sfnQ1Olad6vbQsRamQcaER5_tpc'

export const supabase = createClient(supabaseUrl, supabaseKey)