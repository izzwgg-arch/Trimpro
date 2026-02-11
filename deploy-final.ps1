# Trim Pro - Final Deployment Script

param(
    [string]$sshKey = "C:\Users\izzyw\.ssh\contabo_trimpro"
)

$SERVER_USER = "root"
$SERVER_IP = "154.12.235.86"

Write-Host "==========================================" -ForegroundColor Green
Write-Host "Trim Pro - Final Deployment" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Server: $SERVER_USER@$SERVER_IP" -ForegroundColor Yellow
Write-Host ""

Write-Host "🚀 Starting deployment..." -ForegroundColor Cyan

# Create a simple deployment command
$deployCommand = @"
echo '🚀 Trim Pro Deployment Started'

# Update system
apt-get update -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install PM2
npm install -g pm2

# Install PostgreSQL
apt-get install -y postgresql postgresql-contrib -y

# Start PostgreSQL
systemctl start postgresql
systemctl enable postgresql

# Create database and user
sudo -u postgres psql -c 'CREATE DATABASE trimpro; CREATE USER trimpro_user WITH ENCRYPTED PASSWORD '"'"'TrimPro2024!Secure'"'"'; GRANT ALL PRIVILEGES ON DATABASE trimpro TO trimpro_user; ALTER DATABASE trimpro OWNER TO trimpro_user;'

# Install Redis
apt-get install -y redis-server -y

# Start Redis
systemctl start redis-server
systemctl enable redis-server

# Create app directory
mkdir -p /root/apps
cd /root/apps

# Clone repository
git clone https://github.com/izzwgg-arch/Trimpro.git trimpro
cd trimpro

# Install dependencies
npm install --production=false

# Generate Prisma client
npx prisma generate

# Create environment file
cat > .env << 'ENVEOF'
DATABASE_URL="postgresql://trimpro_user:TrimPro2024!Secure@localhost:5432/trimpro?schema=public"
REDIS_URL="redis://localhost:6379"
JWT_SECRET="trimpro-jwt-secret-$(openssl rand -base64 32 | tr -d '\n')"
JWT_REFRESH_SECRET="trimpro-refresh-secret-$(openssl rand -base64 32 | tr -d '\n')"
NEXT_PUBLIC_APP_URL="http://154.12.235.86:3000"
NODE_ENV="production"
ENVEOF

# Push database schema
npx prisma db push --skip-generate

# Build application
NEXT_TELEMETRY_DISABLED=1 npm run build

# Start with PM2
pm2 stop trimpro 2>/dev/null
pm2 delete trimpro 2>/dev/null
PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production pm2 start npm --name trimpro -- start

# Save PM2 configuration
pm2 save

echo '✅ Deployment completed!'
echo '🌐 Application running at: http://154.12.235.86:3000'
echo '📊 PM2 Status:'
pm2 status trimpro
"@

Write-Host "🔐 Executing deployment..." -ForegroundColor Cyan

try {
    $result = ssh -o StrictHostKeyChecking=no -i $sshKey $SERVER_USER@$SERVER_IP $deployCommand
    Write-Host $result
    Write-Host ""
    Write-Host "✅ Deployment completed!" -ForegroundColor Green
    Write-Host "🌐 Access your application at: http://$SERVER_IP:3000" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "📊 To monitor: ssh -i $sshKey $SERVER_USER@$SERVER_IP 'pm2 logs trimpro -f'" -ForegroundColor Cyan
} catch {
    Write-Host "❌ Deployment failed!" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    exit 1
}
