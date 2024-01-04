module Ddm
  module DetailsPrioritySorted
    def self.included(klass)
      unless klass.new.respond_to?(:details)
        raise ArgumentError, "klass must have #details association"
      end
      klass.extend(ClassMethods)
    end

    module ClassMethods
      def details_priority_sorted(id: nil)
        sort_map = Enumerator.new do |out|
          visited_items = Set.new
          group_names = []
          Ddm::DeviceGroup.preload(:items).each do |group|
            group_names << group.name
            group.items.each do |item|
              next if visited_items.include?(item.device_identifier)
              visited_items << item.device_identifier
              out << item.device_identifier
            end
          end
          group_names.each(&out)
          out << nil
        end.to_a

        Enumerator.new do |out|
          details_group = (id ? where(id: id) : preload(:details)).find_each do |me|
            details_indexed = me.details.index_by(&:target_identifier)
            out << [me, sort_map.filter_map { |target_identifier| details_indexed[target_identifier] }]
          end
        end
      end
    end
  end
end
