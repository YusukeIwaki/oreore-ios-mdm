class SinatraStdoutLogging
  def initialize(app)
    @app = app
    @logger = Logger.new(STDOUT)
  end

  def call(env)
    original_logger = env['rack.logger']
    env['rack.logger'] = @logger
    @app.call(env)
  ensure
    env['rack.logger'] = original_logger
  end
end
