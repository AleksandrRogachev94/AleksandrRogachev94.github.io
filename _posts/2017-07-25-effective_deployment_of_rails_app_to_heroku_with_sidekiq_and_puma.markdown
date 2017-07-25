---
layout: post
title:  "Effective Deployment of Rails App to Heroku with Sidekiq and Puma"
date:   2017-07-25 18:11:40 +0000
---


For the first time, it can be very confusing and hard to sort out how to deploy your app using all available resources on Heroku. In this post I would like to explain how to effectively configure your Rails app on Heroku (specifically, Free Tier).

First of all, about terminology. Let's talk about processes and threads. Processes are isolated from one another at the OS level. Different processes work independently with different memory and resources. In it's turn, processes can consist of multiple threads. Each thread shares the same memory but uses resources independently. Puma thread can handle 1 request at a time. Using threads requires your program to be thread-safety.

Puma is a concurrent web server. It allows both processes and threads. When you have more than one process, your app works in *cluster mode*. Puma's worker is a process. Heroku dyno is something slightly different, a lightweight Linux container. **Each Heroku's dyno can have multiple Puma's workers.** Puma and Heroku both have `workers`. But it's important to understand that they mean different things. Heroku workers are essentially dynos. It's purpose is too perform background jobs. So Heroku generally has two types of dynos: web (your app that takes requests and makes responses) and workers (background jobs).

In this post I explain how to configure apps that perform time consuming operations (like uploading files to a Storage using delayed_paperclip) in background regime using sidekiq gem. Sidekiq is an ActiveJob's backend adapter. It queues and performs background jobs. It works by dynamically spawning multiple worker threads from a single master worker process. Queueing is implemented using third-party simple database Redis. In Sidekiq we have 2 parts: **Client** (that queues jobs to Redis) and **Server** (that dequeues from Redis and performs jobs in background). Both of them are connected to Redis. Client and Server should be separated dynos. Specifically, client is web dyno and server is worker dyno.

This way, your web dynos work independently from worker dynos. It significantly increases response time. Use Heroku's workers for time consuming operations.

Now let's talk about database connection pool. It is a set of connections to database to be used by your application or process. In our case we should consider 2 pools: for your custom PostgreSQL database and for Redis database.

Enough theory. Let's go to practice. Heroku free tier has limitations of connections pools: 20 connections for PostgreSQL and 10 for Redis (Redis To Go Nano add-on). Here I will show how to calculate configuration parameters to use these numbers effectively.

We will have **one web dyno with two Puma workers** and **one worker dyno** (free account allows it).

First of all, let's **configure Puma**.

```ruby
# /config/puma.rb file.
workers Integer(ENV['WEB_CONCURRENCY'] || 2)
threads_count = Integer(ENV['MAX_THREADS'] || 5)
threads threads_count, threads_count

preload_app!

rackup      DefaultRackup
port        ENV.fetch("PORT") { 3000 }
environment ENV.fetch("RAILS_ENV") { "development" }

before_fork do
  puts "Puma master process about to fork. Closing existing Active record connections."
  ActiveRecord::Base.connection.disconnect!
end

on_worker_boot do
  ActiveRecord::Base.establish_connection
end

plugin :tmp_restart
```

In these lines of code we set number of Puma processes equals to 2 (cluster mode). Since default value for your custom database pool size for each Puma process is 5, total pool size in web dyno is 10. Then, we set number of threads for each process by default equals to 5 (Heroku recommends). Each of them will have its own separate connection to PostgreSQL database (10 = 10). The purpose of preload_app! is to speed up the worker creation process. The `before_fork` and `on_worker_boot` blocks are only required if you are using `preload_app!`. They eliminate connections leakage.

Secondly, let's calculate **Sidekiq client and server** side configurations.

Since queuing a job to Redis is very quick operation, it is okay to have small amount of connections to Redis in your client side (web dyno). Actually, since 10 connections to Redis is exhaustive, I use only 1 connection for each web process. Since we have 2 Puma processes in web dyno, for now we have 2/10 connections to Redis.

We have 8 more connections for Sidekiq server. Internally, Sidekiq requires 2 connections itself to work. So we have 6 connections. This is the concurrency value in the configuration (sidekiq.yml). So we ended up with the following configuration files:

/config/sidekiq.yml:

```yaml
development:
  :concurrency: 5
production:
  :concurrency: 6
:queues:
  - default
```

```ruby
#/config/initializers/sidekiq.rb
if Rails.env.production?

  Sidekiq.configure_client do |config|
    config.redis = { url: ENV['REDISTOGO_URL'] || ENV['REDIS_URL'], size: 1 }
  end

  Sidekiq.configure_server do |config|
    pool_size = ENV['SIDEKIQ_DB_POOL'] || (Sidekiq.options[:concurrency] + 2)
    config.redis = { url: ENV['REDISTOGO_URL'] || ENV['REDIS_URL'], size: pool_size }

    Rails.application.config.after_initialize do
      Rails.logger.info("DB Connection Pool size for Sidekiq Server before disconnect is: #{ActiveRecord::Base.connection.pool.instance_variable_get('@size')}")
      ActiveRecord::Base.connection_pool.disconnect!

      ActiveSupport.on_load(:active_record) do
        db_config = Rails.application.config.database_configuration[Rails.env]
        db_config['reaping_frequency'] = ENV['DATABASE_REAP_FREQ'] || 10 # seconds
        db_config['pool'] = pool_size
        ActiveRecord::Base.establish_connection(db_config)
        Rails.logger.info("DB Connection Pool size for Sidekiq Server is now: #{ActiveRecord::Base.connection.pool.instance_variable_get('@size')}")
      end
    end
  end
end
```

This code can look quite complex. Generally, configure_client and configure_server blocks do exactly what their names mean. It sets Redis url, client connection pool to 1, server connection pool to `concurrency + 2` (as I explained), and makes some additional configurations. The bunch of `disconnect!` and `establish_connection` code in the `Sidekiq.configure_server` block is to allow us to customize the number of ActiveRecord DB connections the `worker` dyno will have. It sets number of connections to PostgreSQL database in worker dyno equals to number of connections to Redis (concurrency + 2 = 8). It is needed because sidekiq can spawn number of threads equals to number of connections to Redis. So now total amount of connections to PostgreSQL is 10 + 8 = 18/20. We have 2 unused connections to PotgreSQL. We don't need them since bottleneck is the number of connections to Redis.

To sum up, in current configuration we use 10/10 Redis and 18/20 PostgreSQL connections. I would say that it is the optimal configuration for Heroku Free Tier.

Generally, you can use the following formulas for Redis connections pool (https://bryanrite.com/heroku-puma-redis-sidekiq-and-connection-limits/):

```
Client Size = Puma Workers * (Puma Threads / 2) * Heroku Web Dynos  

Server Size = (Redis Connection Limit - Client Size - 2) / Heroku Job Dynos
```

In these formulas author uses Puma Threads / 2 for client side. I use 1.

For deployment you can us the following Procfile:

```
web: bundle exec puma -C config/puma.rb  
worker: bundle exec sidekiq -e production -C config/sidekiq.yml
```

After deploying don't forget to run `heroku ps:scale worker=1`. It enables one worker.

That's it for today. I hope it was helpful and understandable article. Do not hesitate to ask me any questions :)

Helpful and related articles:

http://julianee.com/rails-sidekiq-and-heroku/

https://bryanrite.com/heroku-puma-redis-sidekiq-and-connection-limits/
