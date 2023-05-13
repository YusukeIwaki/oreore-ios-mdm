class CommandQueue
  def initialize(device_identifier)
    redis = Redis.new(url: ENV['REDIS_URL'])
    @redis_queue = Redis::Queue.new("#{device_identifier}_q", "#{device_identifier}_p", redis: redis)
  end

  def <<(command)
    @redis_queue << command.request_payload.to_plist
  end

  def first
    @redis_queue.pop(true)
  end

  def commit
    @redis_queue.commit
  end

  def rollback
    @redis_queue.refill
  end

  def size
    @redis_queue.size
  end

  def clear
    @redis_queue.clear
  end
end
