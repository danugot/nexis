FROM node:18-alpine

WORKDIR /app

# Copy package files first for caching
COPY package*.json ./

# Install dependencies (if not already in volume, but node_modules volume handles this)
# However, during build we need them.
RUN npm install

# Copy source
COPY . .

# Expose Vite port
EXPOSE 5173

# Start development server
CMD ["npm", "run", "dev", "--", "--host"]
