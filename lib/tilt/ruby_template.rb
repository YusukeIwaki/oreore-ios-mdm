# https://stackoverflow.com/questions/5960381/sinatra-render-a-ruby-file/5962767#5962767
module Tilt
  class RubyTemplate < Template
    def prepare
      # stub
    end

    def evaluate(scope, locals, &block)
      super(scope, locals, &block)
    end

    def precompiled_template(locals)
      data.to_str
    end
  end
end
