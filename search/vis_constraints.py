"""
Visualization Constraints Module

This module provides a modular constraint system for visualization composition.
It includes constraint definitions, validation, and filtering mechanisms to ensure
only valid compositions are selected during the MCGS process.
"""

from typing import Dict, List, Optional, Set, Tuple, Union
from enum import Enum


class ConstraintType(Enum):
    """
    Enumeration of constraint types in the visualization system
    
    This enumeration defines all possible constraint types used for passing and validating
    constraints between visualization nodes. Each constraint type corresponds to a string value
    used as a key in the constraint dictionary.
    """
    # Coordinate system constraints, such as Cartesian or polar
    COORDINATE_SYSTEM = "coordinate_system"
    
    # Spatial arrangement constraints, such as horizontal, vertical, radial, etc.
    SPATIAL_ARRANGEMENT = "spatial_arrangement"
    
    # Column arrangement constraints
    COLUMNS = "columns"
    
    # Arrangement column constraints
    ARRANGEMENTS = "arrangements"
    
    @staticmethod
    def get_constraint_key(constraint_type):
        """Get the string key corresponding to the constraint type"""
        return constraint_type.value


class CoordinateSystem(Enum):
    """Coordinate system types."""
    CARTESIAN = "cartesian"
    POLAR = "polar"
    IRREGULAR = "irregular"


class ConstraintManager:
    """
    Manages all constraints for visualization composition.
    
    This class provides methods to:
    1. Compute constraints for nodes
    2. Validate constraint compatibility
    3. Filter valid options based on constraints
    4. Check node safety for business logic constraints
    """
    
    def __init__(self):
        # Pattern-arrangement compatibility mapping
        self.pattern_arrangements = {
            "repetition": ["horizontal", "vertical", "circular", "radial", "irregular", "regular_tessellation", "irregular_tessellation"],
            "stack": ["horizontal", "vertical", "circular", "radial", "irregular"],
            "mirror": ["horizontal", "vertical", "circular"],
            "linkage": ["horizontal", "vertical", "irregular"],
            "coaxis": ["horizontal", "vertical"],
            "coordinate": ["in_place"], 
            "annotation": ["nearby"],
            "nesting": ["in_place"]
        }
        
        # Arrangement-coordinate system mapping
        self.arrangement_coordinate_system = {
            "horizontal": CoordinateSystem.CARTESIAN,
            "vertical": CoordinateSystem.CARTESIAN,
            "radial": CoordinateSystem.POLAR,
            "circular": CoordinateSystem.POLAR,
            "irregular": CoordinateSystem.IRREGULAR,
            "regular_tessellation": CoordinateSystem.IRREGULAR,  
            "irregular_tessellation": CoordinateSystem.IRREGULAR,
            "in_place": CoordinateSystem.IRREGULAR,
            "nearby": CoordinateSystem.IRREGULAR
        }
        
        # Join axis orientation mapping
        self.join_axis_orientation = {
            "horizontal": "vertical",
            "vertical": "horizontal", 
            "radial": "circular",
            "circular": "radial",
            "irregular": "irregular",
        }

        self.global_column_constraints = {}
        self.global_coordinate_system = None
        self.global_stack_arrangements = {}
        
    def compute_constraints(self, vis_node, data_node_to_vis_node, valid_children) -> Dict:
        """
        Compute constraints for a visualization node
        
        Args:
            vis_node: Visualization node
            data_node_to_vis_node: Mapping from data nodes to visualization nodes
            
        Returns:
            Dict: Constraint dictionary
        """
        if not vis_node.composite_pattern:
            return {}
            
        if vis_node.spatial_arrangement in ["horizontal", "vertical", "radial", "circular"]:
            # Set coordinate system constraint
            coord_key = ConstraintType.COORDINATE_SYSTEM.value
            columns_key = ConstraintType.COLUMNS.value
            arrangements_key = ConstraintType.ARRANGEMENTS.value
            
            vis_node.constraints[coord_key] = self.arrangement_coordinate_system[vis_node.spatial_arrangement].value
            self.global_coordinate_system = vis_node.constraints[coord_key]
            if vis_node.composite_pattern and vis_node.composite_pattern == "stack":
                if vis_node.spatial_arrangement not in self.global_stack_arrangements:
                    self.global_stack_arrangements[vis_node.spatial_arrangement] = 0
                self.global_stack_arrangements[vis_node.spatial_arrangement] += 1
            column = vis_node.data_node.operation.column if vis_node.data_node else None
            arrangement = vis_node.spatial_arrangement
            
            if "join" in vis_node.data_node.node_type:
                arrangement = self.join_axis_orientation.get(vis_node.spatial_arrangement, vis_node.spatial_arrangement)
                
            # Set column and arrangement constraints
            vis_node.constraints[columns_key][column] = arrangement
            vis_node.constraints[arrangements_key][arrangement] = column
            self.global_column_constraints[column] = arrangement
            
            # Set constraints for child nodes
            for child in valid_children:
                child_vis_node = child
                if child_vis_node and vis_node.composite_pattern != "linkage":
                    if "join" in vis_node.data_node.node_type:
                        # Check coordinate system constraint
                        if coord_key in child_vis_node.constraints:
                            if child_vis_node.constraints[coord_key] != vis_node.constraints[coord_key]:
                                raise ValueError(f"Coordinate system mismatch between {vis_node} and child node {child_vis_node}")
                                
                        child_vis_node.constraints[coord_key] = vis_node.constraints[coord_key]
                        
                        # Check column constraint
                        if column in child_vis_node.constraints[columns_key]:
                            if child_vis_node.constraints[columns_key][column] != arrangement:
                                raise ValueError(f"Column arrangement mismatch between {vis_node} and child node {child_vis_node}")
                                
                        # Check arrangement constraint
                        if arrangement in child_vis_node.constraints[arrangements_key]:
                            if child_vis_node.constraints[arrangements_key][arrangement] != column:
                                raise ValueError(f"Arrangement mismatch between {vis_node} and child node {child_vis_node}")
                                
                        # Set child node constraints
                        child_vis_node.constraints[columns_key][column] = arrangement
                        child_vis_node.constraints[arrangements_key][arrangement] = column

    def get_children_constraints(self, vis_node, data_node_to_vis_node, valid_children) -> Dict:
        """
        Compute all constraints for a given visualization node
        
        Args:
            vis_node: The VisNode to compute constraints for
            data_node_to_vis_node: Mapping from data nodes to visualization nodes
            
        Returns:
            Dictionary mapping constraint types to constraint values
        """
        # Use enumeration values as dictionary keys
        columns_key = ConstraintType.COLUMNS.value
        arrangements_key = ConstraintType.ARRANGEMENTS.value
        coord_key = ConstraintType.COORDINATE_SYSTEM.value
        spatial_key = ConstraintType.SPATIAL_ARRANGEMENT.value
        
        # Initialize constraint dictionary
        constraints = {
            columns_key: {},
            arrangements_key: {},
            coord_key: ["cartesian", "polar"],
            spatial_key: ["horizontal", "vertical", "radial", "circular", "irregular", "regular_tessellation", "irregular_tessellation", "in_place", "nearby"],
        }
        
        # Copy nested dictionaries
        for col, arrangement in vis_node.constraints[columns_key].items():
            constraints[columns_key][col] = [arrangement]
            
        for arr, col in vis_node.constraints[arrangements_key].items():
            constraints[arrangements_key][arr] = [col]
        # Include global column constraints
        for col, arrangements in self.global_column_constraints.items():
            if col not in constraints[columns_key]:
                constraints[columns_key][col] = [arrangements]
            else:
                if isinstance(constraints[columns_key][col], str):
                    # Convert to list if it's a single string
                    constraints[columns_key][col] = [constraints[columns_key][col]]
                
                # Add any global arrangements not already in the constraint
                for arr in arrangements:
                    if arr not in constraints[columns_key][col]:
                        constraints[columns_key][col].append(arr)
        if self.global_coordinate_system:
            # Ensure global coordinate system is included
            constraints[coord_key] = [self.global_coordinate_system]
        # Process coordinate system constraints
        if vis_node.constraints.get(coord_key):
            constraints[coord_key] = [vis_node.constraints[coord_key]]
            
        # Process child node constraints
        for child in valid_children:
            child_vis_node = child
            # Process column constraints
            if columns_key in child_vis_node.constraints:
                for col in child_vis_node.constraints[columns_key]:
                    if col not in constraints[columns_key]:
                        constraints[columns_key][col] = []
                    if child_vis_node.constraints[columns_key][col] not in constraints[columns_key][col]:
                        constraints[columns_key][col].append(child_vis_node.constraints[columns_key][col])
            
            # Process arrangement constraints
            if arrangements_key in child_vis_node.constraints:
                for arrangement in child_vis_node.constraints[arrangements_key]:
                    if arrangement not in constraints[arrangements_key]:
                        constraints[arrangements_key][arrangement] = []
                    if child_vis_node.constraints[arrangements_key][arrangement] not in constraints[arrangements_key][arrangement]:
                        constraints[arrangements_key][arrangement].append(child_vis_node.constraints[arrangements_key][arrangement])
            
            # Process spatial arrangement constraints
            if child_vis_node and spatial_key in child_vis_node.constraints:
                constraints[spatial_key] = [_ for _ in constraints[spatial_key] if _ in child_vis_node.constraints[spatial_key]]
                
            # Process coordinate system constraints
            if child_vis_node and coord_key in child_vis_node.constraints:
                constraints[coord_key] = [_ for _ in constraints[coord_key] if _ == child_vis_node.constraints[coord_key]]
        return constraints
    
    def get_valid_composite_patterns(self, vis_node, constraints: Dict, has_operation=False) -> List[str]:
        """
        Get valid composite patterns based on constraints.
        
        Args:
            vis_node: The VisNode
            constraints: Current constraints
            has_operation: Whether the node has an operation
            
        Returns:
            List of valid composite patterns
        """
        if not vis_node.data_node:
            return []
        
        # Use enumeration for constraint keys
        columns_key = ConstraintType.COLUMNS.value
        
        base_patterns = vis_node.composite_patterns.copy()
        non_composable_patterns = ["coaxis", "mirror", "coordinate", "annotation", "nesting", "linkage"]
        if has_operation:
            base_patterns = [pattern for pattern in base_patterns if pattern not in non_composable_patterns]
        
        for col in constraints[columns_key]:
            if col == vis_node.data_node.operation.column:
                if len(constraints[columns_key][col]) > 1:
                    base_patterns = [pattern for pattern in base_patterns if pattern in ["linkage", "coordinate", "annotation", "nesting"]]
        
        return base_patterns
    
    def get_valid_spatial_arrangements(self, vis_node, composite_pattern: str, constraints: Dict, has_operation=False) -> List[str]:
        """
        Get valid spatial arrangements for a given composite pattern and constraints
        
        Args:
            vis_node: Visualization node
            composite_pattern: Selected composite pattern
            constraints: Current constraints
            has_operation: Whether the node has an operation
            
        Returns:
            List of valid spatial arrangements
        """
        # Use enumeration constants to get constraint keys
        spatial_key = ConstraintType.SPATIAL_ARRANGEMENT.value
        coord_key = ConstraintType.COORDINATE_SYSTEM.value
        columns_key = ConstraintType.COLUMNS.value
        arrangements_key = ConstraintType.ARRANGEMENTS.value
        
        # Get base arrangements for this pattern
        valid_arrangements = self.pattern_arrangements.get(composite_pattern, []).copy()
        if vis_node.spatial_arrangements:
            valid_arrangements = [arr for arr in valid_arrangements if arr in vis_node.spatial_arrangements]

        for arrangement, count in self.global_stack_arrangements.items():
            if count > 1:
                if arrangement in valid_arrangements:
                    valid_arrangements = [arrangement]
                else:
                    valid_arrangements = []
                break
        # Apply spatial arrangement constraints
        if spatial_key in constraints:
            valid_arrangements = [arr for arr in valid_arrangements if arr in constraints[spatial_key]]
            
        # Temporarily filter out irregular-related arrangements
        irregular_arrangements = ["irregular"]
        valid_arrangements = [arr for arr in valid_arrangements if arr not in irregular_arrangements]
        
        # Special handling for repetition pattern with operations
        if has_operation and composite_pattern == "repetition":
            valid_arrangements = [arr for arr in valid_arrangements if arr != "regular_tessellation"]
            
        # Early return for specific composite patterns
        if composite_pattern in ["coaxis", "coordinate", "annotation", "nesting", "linkage"]:
            return valid_arrangements
        
        # Get operation column
        operation_column = vis_node.data_node.operation.column if vis_node.data_node else None
        
        # Apply coordinate system constraints
        coordinate_system = constraints.get(coord_key, [])
        if len(coordinate_system) <= 1:
            res = []
            if CoordinateSystem.POLAR.value in coordinate_system:
                res += [arr for arr in valid_arrangements if arr in ["radial", "circular"]]
            if CoordinateSystem.CARTESIAN.value in coordinate_system:
                res += [arr for arr in valid_arrangements if arr in ["horizontal", "vertical"]]
            valid_arrangements = res
        
        # Apply arrangement constraints
        for arrangement in constraints[arrangements_key]:
            if [operation_column] == constraints[arrangements_key][arrangement]:
                continue
            if "join" in vis_node.data_node.node_type:
                arrangement = self.join_axis_orientation.get(arrangement, arrangement)
            if arrangement in valid_arrangements:
                valid_arrangements.remove(arrangement)
        
        # Apply column constraints
        if operation_column in constraints[columns_key] and composite_pattern not in ["coaxis", "coordinate", "annotation", "nesting", "linkage"]:
            column_arrangements = constraints[columns_key][operation_column]
            if len(column_arrangements) == 1:
                arrangement = column_arrangements[0]
                if "join" in vis_node.data_node.node_type:
                    arrangement = self.join_axis_orientation.get(arrangement, arrangement)
                if arrangement in valid_arrangements:
                    valid_arrangements = [arrangement]
                else:
                    valid_arrangements = []
                
        return valid_arrangements
    
    def get_valid_spatial_distributions(self, composite_pattern: str, spatial_arrangement: str) -> List[str]:
        """
        Get valid spatial distributions for a given composite pattern.
        
        Args:
            composite_pattern: The selected composite pattern
            
        Returns:
            List of valid spatial distributions
        """
        # Default distributions
        valid_distributions = ["equal", "proportional"]
        
        # Patterns that only support equal distribution
        equal_only_patterns = ["coaxis", "mirror"]
        
        if composite_pattern in equal_only_patterns:
            return ["equal"]
        
        if composite_pattern == "repetition":
            if spatial_arrangement in ["horizontal", "vertical", "radial", "circular"]:
                return ["equal"]
        # tmp
        if composite_pattern == "stack":
            return ["proportional"]
        return valid_distributions
    
    def get_valid_children_order(self, vis_node, valid_children_indices, must_children_indices) -> List[Tuple[int]]:
        candidate_children_order = vis_node.selected_children_order_N.keys()
        # Check if all indices in the candidate order are valid
        valid_orders = []
        for order_tuple in candidate_children_order:
            if all(idx in valid_children_indices for idx in order_tuple) and all(idx in order_tuple for idx in must_children_indices):
                valid_orders.append(order_tuple)
        return valid_orders
    
    def _validate_center_dimension_constraints(self, all_vis_nodes: Set):
        """Validate center dimension constraints."""
        center_dimension = None
        for vis_node in all_vis_nodes:
            if vis_node.data_node is None:
                continue
            if vis_node.data_node.node_type == "all_union" and len(vis_node.children) == 0:
                _center_dimension = vis_node.data_node.operation.column
                if center_dimension is not None and center_dimension != _center_dimension:
                    raise ValueError(f"Tree conflict: multiple center dimensions found in the tree")
                center_dimension = _center_dimension
    
    def _has_composable_pattern(self, candidate_node, chosen_operation_nodes: List) -> bool:
        """
        Test if a candidate node can be safely added without violating business logic constraints.
        
        Args:
            candidate_node: The VisNode to test
            chosen_operation_nodes: List of already chosen operation nodes
            
        Returns:
            bool: True if the node can be safely added
        """
        if not candidate_node.data_node:
            return True
        
        if len(chosen_operation_nodes) >= 1:
            non_composable_patterns = {"coaxis", "mirror", "coordinate", "annotation", "nesting", "linkage"}
            if all(pattern in non_composable_patterns for pattern in candidate_node.composite_patterns):
                return False
        
        return True
    
    def _has_non_composable_pattern(self, chosen_operation_nodes: List) -> bool:
        """
        Check if a non-composable pattern has been selected
        
        Args:
            chosen_operation_nodes: List of selected operation nodes
            
        Returns:
            bool: True if a non-composable pattern exists, False otherwise
        """
        # Define list of non-composable patterns
        non_composable_patterns = ["coaxis", "mirror", "coordinate", "annotation", "nesting", "linkage"]
        
        # Check special combination: repetition+tessellation
        has_repetition_tessellation = any(
            node.composite_pattern == "repetition" and 
            node.spatial_arrangement is not None and 
            "tessellation" in node.spatial_arrangement
            for node in chosen_operation_nodes if hasattr(node, 'composite_pattern') and node.composite_pattern
        )
        
        # Check other non-composable patterns
        has_non_composable_pattern = any(
            hasattr(node, 'composite_pattern') and 
            node.composite_pattern in non_composable_patterns
            for node in chosen_operation_nodes
        )
        
        return has_repetition_tessellation or has_non_composable_pattern
    
    def get_global_column_constraint(self, column):
        """
        Get global constraints for a specific column
        
        Args:
            column: The column name to get constraints for
            
        Returns:
            List of arrangements that have been applied to this column
        """
        return self.global_column_constraints.get(column, [])
    
    def get_all_global_column_constraints(self):
        """
        Get all global column constraints
        
        Returns:
            Dictionary mapping column names to their arrangement constraints
        """
        return self.global_column_constraints.copy()
    
    def clear_global_constraints(self):
        """Clear all global constraints"""
        self.global_column_constraints = {}
        self.global_coordinate_system = None
        self.global_stack_arrangements = {}

# Global constraint manager instance
constraint_manager = ConstraintManager()
