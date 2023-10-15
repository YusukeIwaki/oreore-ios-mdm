module Ddm
  module ResourceIdentifierResolvable
    class InsufficientResourceIdentifiers < StandardError
      def initialize(resource_identifiers)
        super("Required resource_identifiers: [#{resource_identifiers.join(', ')}]")
      end
    end

    # requires responding to :payload and return a Hash
    # However explicit method definition is not required since method_mising is often used (liek ActiveRecord::Base).
    # def payload
    #   raise NotImplementedError, 'payload method must be implemented'
    # end

    class Collector
      def initialize(hash)
        @hash = hash
      end

      # @return [Array<String>]
      def collect_resource_identifiers
        deep_collect_resource_identifiers(@hash)
      end

      private

      # @param [Hash|Array|String] target
      # @return [Array<String>]
      def deep_collect_resource_identifiers(target)
        result = Set.new
        case target
        when Hash
          target.each do |_, value|
            result.merge(deep_collect_resource_identifiers(value))
          end
        when Array
          target.each do |value|
            result.merge(deep_collect_resource_identifiers(value))
          end
        when /\A@[a-z]+\/[a-zA-Z0-9._-]+\z/
          result << target
        end
        result.to_a
      end
    end

    class Replacer
      def initialize(hash, resource_identifier_map)
        @hash = hash
        @resource_identifier_map = resource_identifier_map
      end

      def replace_resource_identifiers
        deep_replace_resource_identifiers(@hash)
      end

      private

      # @param [Hash|Array|String] target
      # @return [Hash|Array|String]
      def deep_replace_resource_identifiers(target)
        case target
        when Hash
          target.map do |key, value|
            [key, deep_replace_resource_identifiers(value)]
          end.to_h
        when Array
          target.map do |value|
            deep_replace_resource_identifiers(value)
          end
        when /\A@[a-z]+\/[a-zA-Z0-9._-]+\z/
          @resource_identifier_map[target]
        else
          target
        end
      end
    end

    # @param [Array<String>] candidate_resource_identifiers
    # @return [Array<String>]
    def collect_required_resource_identifiers_from(candidate_resource_identifiers)
      required_resource_identifiers = Collector.new(payload).collect_resource_identifiers
      required_resource_identifiers & candidate_resource_identifiers
    end

    # @param [Hash<String, *>] reference_identifier_map
    # @return [Hash]
    # @raise [InsufficientResourceIdentifiers]
    def reference_identifier_resolved_payload(reference_identifier_map)
      required_resource_identifiers = Collector.new(payload).collect_resource_identifiers
      insufficient_resource_identifiers = required_resource_identifiers - reference_identifier_map.keys
      unless insufficient_resource_identifiers.empty?
        raise InsufficientResourceIdentifiers.new(insufficient_resource_identifiers.to_a)
      end

      Replacer.new(payload, reference_identifier_map).replace_resource_identifiers
    end
  end
end
