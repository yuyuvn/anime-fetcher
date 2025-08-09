FROM node:22

# Set working directory
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source code
COPY . .

# Expose the port (default 5321, can be overridden by env)
EXPOSE 5321

# Set environment variables (optional, can be overridden at runtime)
ENV PORT=5321
ENV DATA_DIR=data

# Start the app
CMD ["npm", "start"]
