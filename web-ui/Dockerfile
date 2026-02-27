FROM alpine:latest
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories && \
    apk add --no-cache nodejs npm
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
