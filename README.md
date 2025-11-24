# MedGuard - Drug Information Lookup Application

## Project Structure

```
medguard/
├── backend/
│   ├── server.js
│   ├── .env
│   ├── package.json
│   └── .gitignore
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
└── README.md
```

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- OpenFDA API (no key required for basic usage)

### Backend Setup

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install express cors dotenv axios helmet express-rate-limit
   ```

3. **Create .env file:**
   ```
   PORT=3000
   NODE_ENV=development
   ```

4. **Run the server:**
   ```bash
   node server.js
   ```

### Frontend Setup

1. **Open `frontend/index.html` in a web browser**, or
2. **Use a simple HTTP server:**
   ```bash
   cd frontend
   npx http-server -p 8080
   ```

### Deployment to Web Servers

#### Step 1: Prepare Application for Production

1. Update backend `.env`:
   ```
   PORT=3000
   NODE_ENV=production
   ```

2. Install PM2 for process management:
   ```bash
   npm install -g pm2
   ```

#### Step 2: Deploy to Web01 and Web02

**On both Web01 and Web02:**

1. **Upload files to server:**
   ```bash
   scp -r medguard/ user@web01:/var/www/medguard/
   scp -r medguard/ user@web02:/var/www/medguard/
   ```

2. **SSH into each server:**
   ```bash
   ssh user@web01
   ```

3. **Install dependencies:**
   ```bash
   cd /var/www/medguard/backend
   npm install --production
   ```

4. **Start application with PM2:**
   ```bash
   pm2 start server.js --name medguard
   pm2 save
   pm2 startup
   ```

5. **Verify it's running:**
   ```bash
   curl http://localhost:3000/api/health
   ```

#### Step 3: Configure Load Balancer (Lb01)

**On Lb01 server:**

1. **Install Nginx (if not installed):**
   ```bash
   sudo apt update
   sudo apt install nginx
   ```

2. **Create Nginx configuration:**
   ```bash
   sudo nano /etc/nginx/sites-available/medguard
   ```

3. **Add this configuration:**
   ```nginx
   upstream medguard_backend {
       least_conn;
       server <WEB01_IP>:3000 weight=1 max_fails=3 fail_timeout=30s;
       server <WEB02_IP>:3000 weight=1 max_fails=3 fail_timeout=30s;
   }

   server {
       listen 80;
       server_name <YOUR_DOMAIN_OR_IP>;

       # Frontend files
       location / {
           root /var/www/medguard/frontend;
           index index.html;
           try_files $uri $uri/ /index.html;
       }

       # Backend API proxy
       location /api/ {
           proxy_pass http://medguard_backend;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_cache_bypass $http_upgrade;
           
           # Timeout settings
           proxy_connect_timeout 60s;
           proxy_send_timeout 60s;
           proxy_read_timeout 60s;
       }

       # Health check endpoint
       location /health {
           access_log off;
           return 200 "healthy\n";
           add_header Content-Type text/plain;
       }
   }
   ```

4. **Enable the site:**
   ```bash
   sudo ln -s /etc/nginx/sites-available/medguard /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

5. **Upload frontend files to Lb01:**
   ```bash
   scp -r medguard/frontend/ user@lb01:/var/www/medguard/
   ```

#### Step 4: Testing Load Balancer

1. **Test health check:**
   ```bash
   curl http://<LB01_IP>/health
   ```

2. **Test API through load balancer:**
   ```bash
   curl http://<LB01_IP>/api/health
   ```

3. **Test load balancing:**
   ```bash
   for i in {1..10}; do curl http://<LB01_IP>/api/health; done
   ```

4. **Monitor which server handles requests:**
   - Check logs on Web01: `pm2 logs medguard`
   - Check logs on Web02: `pm2 logs medguard`
   - Both should show incoming requests

#### Step 5: Verify Load Distribution

1. **Stop one server to test failover:**
   ```bash
   # On Web01
   pm2 stop medguard
   ```

2. **Access application - should still work via Web02**

3. **Restart Web01:**
   ```bash
   pm2 start medguard
   ```

## Features

- **Drug Search**: Search for medications by name
- **Detailed Information**: View comprehensive drug information including:
  - Purpose and uses
  - Warnings and precautions
  - Dosage and administration
  - Active ingredients
  - Adverse reactions
  - Manufacturer information
- **Search History**: Track recent searches
- **Filtering & Sorting**: Filter results by drug type, sort by name
- **Responsive Design**: Works on desktop and mobile devices
- **Error Handling**: Graceful handling of API errors and network issues
- **Rate Limiting**: Backend protection against excessive requests

## API Endpoints

### Backend API

- `GET /api/health` - Health check endpoint
- `GET /api/search?query=<drug_name>&limit=<number>` - Search for drugs
- `GET /api/drug/:id` - Get detailed drug information

## Technologies Used

### Frontend
- HTML5
- CSS3 (Responsive Design)
- Vanilla JavaScript (ES6+)
- Fetch API for HTTP requests

### Backend
- Node.js
- Express.js
- Axios for API calls
- CORS for cross-origin requests
- Helmet for security headers
- Express-rate-limit for rate limiting
- dotenv for environment variables

### Deployment
- PM2 for process management
- Nginx for load balancing
- Linux servers (Ubuntu/Debian)

## Challenges Encountered and Solutions employed

### Challenge 1: OpenFDA API Response Format
- **Problem**: OpenFDA returns complex nested JSON with inconsistent field availability.
- **Solution**: Implemented comprehensive data extraction functions with fallbacks for missing fields.

### Challenge 2: Rate Limiting
- **Problem**: OpenFDA has rate limits (40 requests/minute without API key).
- **Solution**: Implemented backend caching and request throttling to stay within limits.

### Challenge 3: Load Balancer Configuration
- **Problem**: Ensuring proper session persistence and failover.
- **Solution**: Used Nginx's `least_conn` algorithm and health checks for optimal distribution.

### Challenge 4: Large Response Sizes
- **Problem**: Some drug labels contain massive amounts of data.
- **Solution**: Implemented pagination and data truncation on frontend.

## Security Measures

1. **Helmet.js**: Adds security headers
2. **Rate Limiting**: Prevents API abuse
3. **Input Validation**: Sanitizes user input
4. **CORS**: Configured for specific origins in production
5. **Environment Variables**: Sensitive data stored in .env
6. **No API Key Required**: OpenFDA is public (include note about optional key for higher limits)

## Credits

- **OpenFDA API**: https://open.fda.gov/
  - Provider: U.S. Food and Drug Administration
  - License: Public Domain
- **Data Source**: FDA Structured Product Labeling (SPL)


## License

This project is totally free and up for grabs!!