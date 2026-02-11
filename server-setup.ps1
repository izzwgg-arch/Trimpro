# Trim Pro - Complete Server Setup Script

param(
    [string]$sshKey = "C:\Users\izzyw\.ssh\contabo_trimpro"
)

$SERVER_USER = "root"
$SERVER_IP = "154.12.235.86"
$APP_NAME = "trimpro"
$APP_DIR = "/root/apps/$APP_NAME"

Write-Host "==========================================" -ForegroundColor Green
Write-Host "Trim Pro - Complete Server Setup" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Server: $SERVER_USER@$SERVER_IP" -ForegroundColor Yellow
Write-Host ""

Write-Host "🔧 Setting up server environment..." -ForegroundColor Cyan

# Complete server setup commands
$setupCommands = @"
echo '🚀 Starting complete server setup for Trim Pro...'

# Update system
echo '📦 Updating system packages...'
apt update -y

# Install Node.js 18
echo '📦 Installing Node.js 18...'
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install PM2 globally
echo '📦 Installing PM2...'
npm install -g pm2

# Install PostgreSQL
echo '🗄️ Installing PostgreSQL...'
apt-get install -y postgresql postgresql-contrib -y

# Start and enable PostgreSQL
echo '🔧 Starting PostgreSQL...'
systemctl start postgresql
systemctl enable postgresql

# Install Redis
echo '🔴 Installing Redis...'
apt-get install -y redis-server -y

# Start and enable Redis
echo '🔧 Starting Redis...'
systemctl start redis-server
systemctl enable redis-server

# Create database and user
echo '🗄️ Setting up database...'
sudo -u postgres psql -c "CREATE DATABASE trimpro; CREATE USER trimpro_user WITH ENCRYPTED PASSWORD 'TrimPro2024!Secure'; GRANT ALL PRIVILEGES ON DATABASE trimpro TO trimpro_user; ALTER DATABASE trimpro OWNER TO trimpro_user;"

# Create app directory
echo '📁 Creating app directory...'
mkdir -p /root/apps
cd /root/apps

# Clone repository
echo '📥 Cloning Trim Pro repository...'
git clone https://github.com/izzwgg-arch/Trimpro.git trimpro
cd trimpro

# Install dependencies
echo '📦 Installing dependencies...'
npm install --production=false

# Generate Prisma client
echo '🔧 Generating Prisma client...'
npx prisma generate

# Push database schema
echo '🗄️ Setting up database schema...'
npx prisma db push --skip-generate

# Build application
echo '🏗️ Building application...'
NEXT_TELEMETRY_DISABLED=1 npm run build

# Start with PM2
echo '🚀 Starting application with PM2...'
pm2 stop trimpro 2>$null; if ($?) { $null } else { $null }
pm2 delete trimpro 2>$null; if ($?) { $null } else { $null }
PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production pm2 start npm --name trimpro -- start

# Save PM2 configuration
echo '💾 Saving PM2 configuration...'
pm2 save

# Create environment file
echo '⚙️ Creating environment file...'
cat > .env << 'EOF'
DATABASE_URL="postgresql://trimpro_user:TrimPro2024!Secure@localhost:5432/trimpro?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="trimpro-jwt-secret-$(openssl rand -base64 32 | tr -d '\n')"
JWT_REFRESH_SECRET="trimpro-refresh-secret-$(openssl rand -base64 32 | tr -d '\n')"
NEXT_PUBLIC_APP_URL="http://154.12.235.86:3000"
NODE_ENV="production"
EOF

echo ''
echo '✅ Server setup completed!'
echo '🌐 Application running at: http://154.12.235.86:3000'
echo '📊 PM2 Status:'
pm2 status trimpro
echo ''
echo '📝 Useful Commands:'
echo '  View logs:     pm2 logs trimpro'
echo '  Restart:       pm2 restart trimpro'
echo '  Stop:          pm2 stop trimpro'
echo '  Monitor:       pm2 monit'
echo ''
echo '🔧 Next Steps:'
echo '1. Test the application at http://154.12.235.86:3000'
echo '2. Create admin user using: npm run seed'
echo '3. Configure additional environment variables as needed'
"@

Write-Host "🔐 Executing server setup..." -ForegroundColor Cyan

try {
    $result = ssh -o StrictHostKeyChecking=no -i $sshKey $SERVER_USER@$SERVER_IP $setupCommands
    Write-Host $result
    Write-Host ""
    Write-Host "✅ Server setup completed!" -ForegroundColor Green
    Write-Host "🌐 Access your application at: http://$SERVER_IP:3000" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "📊 To monitor: ssh -i $sshKey $SERVER_USER@$SERVER_IP 'pm2 logs trimpro -f'" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Server setup failed!" -ForegroundColor Red
    $errorMsg = $_.Exception.Message
    Write-Host "Error: $errorMsg" -ForegroundColor Red
    exit 1
}
